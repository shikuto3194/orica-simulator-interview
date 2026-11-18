// Read-only process and aggregate host metering inside Node. No helper tail.
#include <windows.h>
#include <node_api.h>
#include <cmath>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
const napi_type_tag tag = {0x7d84ec42a30921f1ULL, 0xb276489cdc34ac19ULL};
void Check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("process meter Node-API failure");
}
uint64_t Ticks(FILETIME time) {
  return (uint64_t(time.dwHighDateTime) << 32) | time.dwLowDateTime;
}
struct Meter {
  HANDLE handle;
  DWORD pid;
  uint64_t created, lastCpu = 0, lastWriteBytes = 0;
  ~Meter() { Close(); }
  void Close() {
    if (handle) { CloseHandle(handle); handle = nullptr; }
  }
};
napi_value Number(napi_env env, double value) {
  napi_value result; Check(napi_create_double(env, value, &result)); return result;
}
napi_value Decimal(napi_env env, uint64_t value) {
  napi_value result; const std::string text = std::to_string(value);
  Check(napi_create_string_utf8(env, text.c_str(), text.size(), &result)); return result;
}
void Set(napi_env env, napi_value object, const char* key, napi_value value) {
  Check(napi_set_named_property(env, object, key, value));
}
Meter* Receiver(napi_env env, napi_callback_info info) {
  size_t count = 0; napi_value self; bool matches = false;
  Check(napi_get_cb_info(env, info, &count, nullptr, &self, nullptr));
  Check(napi_check_object_type_tag(env, self, &tag, &matches));
  if (!matches) throw std::runtime_error("invalid retained process meter receiver");
  void* pointer; Check(napi_unwrap(env, self, &pointer));
  if (!pointer) throw std::runtime_error("missing retained process meter");
  return static_cast<Meter*>(pointer);
}
napi_value Fail(napi_env env, const std::exception& error) {
  napi_throw_error(env, nullptr, error.what()); return nullptr;
}
napi_value Sample(napi_env env, napi_callback_info info) {
  try {
    Meter* meter = Receiver(env, info);
    if (!meter->handle) throw std::runtime_error("retained process meter closed");
    const DWORD wait = WaitForSingleObject(meter->handle, 0);
    if (wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT)
      throw std::runtime_error("retained process wait failed");
    FILETIME birth, exit, kernel, user; DWORD code; IO_COUNTERS io;
    if (!GetProcessTimes(meter->handle, &birth, &exit, &kernel, &user) ||
        !GetExitCodeProcess(meter->handle, &code) ||
        !GetProcessIoCounters(meter->handle, &io))
      throw std::runtime_error("retained process accounting failed");
    const uint64_t k = Ticks(kernel), u = Ticks(user);
    if (Ticks(birth) != meter->created || UINT64_MAX - k < u ||
        k + u < meter->lastCpu || io.WriteTransferCount < meter->lastWriteBytes ||
        (wait == WAIT_OBJECT_0 && Ticks(exit) < meter->created))
      throw std::runtime_error("retained process identity or CPU changed");
    meter->lastCpu = k + u;
    meter->lastWriteBytes = io.WriteTransferCount;
    napi_value result, signaled;
    Check(napi_create_object(env, &result));
    Check(napi_get_boolean(env, wait == WAIT_OBJECT_0, &signaled));
    Set(env, result, "pid", Number(env, meter->pid));
    Set(env, result, "created", Decimal(env, meter->created));
    Set(env, result, "exited", Decimal(env, wait == WAIT_OBJECT_0 ? Ticks(exit) : 0));
    Set(env, result, "cpuMs", Number(env, double(meter->lastCpu) / 10000.0));
    Set(env, result, "writeTransferBytes", Decimal(env, io.WriteTransferCount));
    Set(env, result, "signaled", signaled);
    Set(env, result, "exitCode", Number(env, code));
    return result;
  } catch (const std::exception& error) { return Fail(env, error); }
}
napi_value Close(napi_env env, napi_callback_info info) {
  try {
    Receiver(env, info)->Close(); napi_value result;
    Check(napi_get_undefined(env, &result)); return result;
  } catch (const std::exception& error) { return Fail(env, error); }
}
void Finalize(napi_env, void* data, void*) { delete static_cast<Meter*>(data); }
napi_value Host(napi_env env, napi_callback_info info) {
  try {
    size_t count = 1; napi_value arg;
    Check(napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr));
    if (count != 0) throw std::runtime_error("host meter accepts no arguments");
    // GetSystemTimes covers one processor group. Refuse a partial system
    // measurement instead of silently understating multi-group host load.
    const WORD groups = GetActiveProcessorGroupCount();
    const DWORD processors = GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
    FILETIME idle, kernel, user;
    MEMORYSTATUSEX memory = {}; memory.dwLength = static_cast<DWORD>(sizeof(memory));
    if (groups != 1 || processors == 0 || processors == 0xffffffff ||
        !GetSystemTimes(&idle, &kernel, &user) || !GlobalMemoryStatusEx(&memory) ||
        Ticks(idle) > Ticks(kernel) || memory.ullTotalPhys == 0 ||
        memory.ullAvailPhys > memory.ullTotalPhys ||
        memory.ullTotalPhys > 9007199254740991ULL)
      throw std::runtime_error("aggregate host counters unavailable");
    napi_value result; Check(napi_create_object(env, &result));
    Set(env, result, "idleTicks", Decimal(env, Ticks(idle)));
    Set(env, result, "kernelTicks", Decimal(env, Ticks(kernel)));
    Set(env, result, "userTicks", Decimal(env, Ticks(user)));
    Set(env, result, "freeRamBytes", Number(env, double(memory.ullAvailPhys)));
    Set(env, result, "totalRamBytes", Number(env, double(memory.ullTotalPhys)));
    Set(env, result, "logicalCpus", Number(env, processors));
    Set(env, result, "processorGroups", Number(env, groups));
    return result;
  } catch (const std::exception& error) { return Fail(env, error); }
}
napi_value Open(napi_env env, napi_callback_info info) {
  try {
    size_t count = 2; napi_value args[2]; double pid;
    Check(napi_get_cb_info(env, info, &count, args, nullptr, nullptr));
    if (count != 1 || napi_get_value_double(env, args[0], &pid) != napi_ok ||
        !std::isfinite(pid) || pid < 1 || pid > UINT32_MAX || std::floor(pid) != pid)
      throw std::runtime_error("invalid process meter PID");
    auto meter = std::make_unique<Meter>();
    meter->pid = static_cast<DWORD>(pid);
    meter->handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, meter->pid);
    if (!meter->handle) throw std::runtime_error("process meter attachment failed");
    FILETIME birth, exit, kernel, user;
    if (WaitForSingleObject(meter->handle, 0) != WAIT_TIMEOUT ||
        !GetProcessTimes(meter->handle, &birth, &exit, &kernel, &user) || Ticks(birth) == 0)
      throw std::runtime_error("process meter target not live");
    meter->created = Ticks(birth);
    napi_value object, sample, close;
    Check(napi_create_object(env, &object));
    Check(napi_type_tag_object(env, object, &tag));
    Check(napi_create_function(env, "sample", NAPI_AUTO_LENGTH, Sample, nullptr, &sample));
    Check(napi_create_function(env, "close", NAPI_AUTO_LENGTH, Close, nullptr, &close));
    Set(env, object, "sample", sample); Set(env, object, "close", close);
    Check(napi_wrap(env, object, meter.get(), Finalize, nullptr, nullptr));
    meter.release();
    return object;
  } catch (const std::exception& error) { return Fail(env, error); }
}
napi_value Init(napi_env env, napi_value exports) {
  try {
    napi_value open, host;
    Check(napi_create_function(env, "open", NAPI_AUTO_LENGTH, Open, nullptr, &open));
    Check(napi_create_function(env, "host", NAPI_AUTO_LENGTH, Host, nullptr, &host));
    Set(env, exports, "open", open); Set(env, exports, "host", host); return exports;
  } catch (const std::exception& error) { return Fail(env, error); }
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
