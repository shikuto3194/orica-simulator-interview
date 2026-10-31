// Read-only process accounting. Retain the query/synchronize handle BEFORE
// exit; never reopen a PID for a terminal measurement or mutate the target.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class OricaProcessMeter : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(SafeProcessHandle process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(SafeProcessHandle process, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(SafeProcessHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessIoCounters(SafeProcessHandle process, out IoCounters counters);
    public sealed class Snapshot {
        public uint pid, exitCode;
        public string created, exited, writeTransferBytes;
        public double cpuMs;
        public bool signaled;
    }
    public sealed class Helper {
        public uint pid, priority;
        public string created, affinityMask, writeTransferBytes;
        public double cpuMs;
        public long rssBytes;
    }
    readonly SafeProcessHandle handle;
    readonly uint pid;
    readonly long created;
    readonly OricaControlLease exitLease;
    double lastCpu;
    ulong lastWriteBytes;
    bool disposed;
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static double Cpu(long kernel, long user) {
        if (kernel < 0 || user < 0) throw new InvalidOperationException("Invalid CPU time");
        return checked(kernel + user) / 10000.0;
    }
    public OricaProcessMeter(uint targetPid) {
        if (targetPid == 0) throw new ArgumentException("Invalid process identity");
        pid = targetPid;
        // SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION only, no kill/write.
        handle = OpenProcess(0x00101000, false, pid);
        if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        try {
            long exit, kernel, user;
            Check(GetProcessTimes(handle, out created, out exit, out kernel, out user));
            if (created <= 0 || WaitForSingleObject(handle, 0) != 258)
                throw new InvalidOperationException("Target not live during attachment");
            lastCpu = Cpu(kernel, user);
            exitLease = new OricaControlLease(handle);
        } catch { handle.Dispose(); throw; }
    }
    public Snapshot Measure(bool terminal) {
        if (disposed) throw new ObjectDisposedException("OricaProcessMeter");
        uint wait = WaitForSingleObject(handle, terminal ? 5000U : 0U);
        if (wait != 0 && wait != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (terminal && wait != 0) throw new InvalidOperationException("Target exit unconfirmed");
        long birth, exit, kernel, user;
        Check(GetProcessTimes(handle, out birth, out exit, out kernel, out user));
        double cpu = Cpu(kernel, user);
        IoCounters io; Check(GetProcessIoCounters(handle, out io));
        if (birth != created || kernel < 0 || user < 0 || cpu < lastCpu || io.WriteBytes < lastWriteBytes || (wait == 0 && exit < birth))
            throw new InvalidOperationException("Process identity or CPU changed");
        lastCpu = cpu;
        lastWriteBytes = io.WriteBytes;
        uint code;
        Check(GetExitCodeProcess(handle, out code));
        return new Snapshot { pid=pid, created=birth.ToString(CultureInfo.InvariantCulture), exited=(wait == 0 ? exit : 0).ToString(CultureInfo.InvariantCulture), cpuMs=cpu, signaled=wait == 0, exitCode=code, writeTransferBytes=io.WriteBytes.ToString(CultureInfo.InvariantCulture) };
    }
    public static Helper Self() {
        using (Process current = Process.GetCurrentProcess()) {
            using (SafeProcessHandle own = OpenProcess(0x00101000, false, (uint)current.Id)) {
                if (own.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                long created, exit, kernel, user;
                Check(GetProcessTimes(own, out created, out exit, out kernel, out user));
                IoCounters io; Check(GetProcessIoCounters(own, out io));
                ulong affinity = unchecked((ulong)current.ProcessorAffinity.ToInt64());
                return new Helper { pid=(uint)current.Id, created=created.ToString(CultureInfo.InvariantCulture), cpuMs=Cpu(kernel,user), rssBytes=current.WorkingSet64, affinityMask=affinity.ToString(CultureInfo.InvariantCulture), priority=(uint)current.PriorityClass, writeTransferBytes=io.WriteBytes.ToString(CultureInfo.InvariantCulture) };
            }
        }
    }
    public void Dispose() { if (!disposed) { disposed=true; exitLease.Dispose(); handle.Dispose(); } }
}
