// Private OS containment primitive; not the R1-runtime acceptance runner.
// Job assignment is atomic with CreateProcess (JOB_LIST), including before
// initial-thread resume. No breakaway or inheritable job handle is permitted.
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public sealed class OricaOwnedJob : IDisposable {
    sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid {
        public SafeJobHandle(IntPtr handle) : base(true) { SetHandle(handle); }
        protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }
    [StructLayout(LayoutKind.Sequential)] struct AccountingWithIo {
        public Accounting Basic;
        public IoCounters Io;
    }
    [StructLayout(LayoutKind.Sequential)] struct MemoryCounters {
        public uint Size, Faults;
        public UIntPtr PeakWorkingSet, WorkingSet, PeakPaged, Paged, PeakNonPaged, NonPaged, Pagefile, PeakPagefile;
    }
    [StructLayout(LayoutKind.Sequential)] struct HostMemory {
        public uint Size, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security, IntPtr name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(SafeJobHandle job, int kind, IntPtr data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessAffinityMask(IntPtr process, out UIntPtr processMask, out UIntPtr systemMask);
    [DllImport("kernel32.dll")] static extern ushort GetActiveProcessorGroupCount();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr env, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(SafeJobHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool belongs);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessIoCounters(IntPtr process, out IoCounters counters);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetPriorityClass(IntPtr process);
    [DllImport("psapi.dll", SetLastError=true)] static extern bool GetProcessMemoryInfo(IntPtr process, ref MemoryCounters counters, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetSystemTimes(out ulong idle, out ulong kernel, out ulong user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref HostMemory memory);

    public sealed class Member { public uint pid; public string created; public ulong rssBytes; }
    public sealed class GuardianSample {
        public uint pid, priority;
        public string created, affinityMask;
        public double cpuMs;
        public ulong rssBytes;
        public string writeTransferBytes;
    }
    public sealed class Sample {
        public uint rootPid, active, exitCode;
        public string rootCreated;
        public double cpuMs;
        public string writeTransferBytes;
        public ulong rssBytes;
        public ulong commitLimitBytes;
        public string affinityMask;
        public uint priority;
        public Member[] members;
        public GuardianSample guardian;
        public double totalCpuMs;
        public ulong totalRssBytes;
        public HostSample host;
        public bool resourceWatchdogEnabled, resourceWatchdogExpired;
        public long writeTransferLimitBytes;
        public bool writeTransferLimitExceeded;
    }
    public sealed class HostSample {
        public uint pid, processorGroups;
        public double atMs;
        public string startToken;
        public string idleTicks, kernelTicks, userTicks;
        public ulong freeRamBytes, totalRamBytes;
    }
    public sealed class TerminalSample {
        public Sample sample;
        public bool rootExited, forced, jobCpuComplete;
    }
    IntPtr job, root, thread;
    SafeJobHandle safeJob;
    Timer deadline;
    Timer resourceWatchdog;
    Timer writeWatchdog;
    readonly long writeTransferLimitBytes;
    int writeTransferLimitExceeded;
    readonly bool resourceWatchdogEnabled;
    // 0 = unarmed/stopped, -1 = expired, positive = monotonic deadline.
    // The timer never waits for the measurement/control mutex.
    long heartbeatDeadline;
    int resourceWatchdogExpired;
    string acknowledgedHostToken;
    volatile bool deadlineFailed;
    readonly object sync = new object();
    readonly Stopwatch hostClock = Stopwatch.StartNew();
    string lastHostToken;
    long lastHostAtMs;
    bool started, disposed, finishing;
    uint pid;
    long rootCreated;
    const ulong HardRssBytes = 3UL * 1024 * 1024 * 1024;
    sealed class MembershipChangedException : InvalidOperationException {
        public string ReasonCode { get; private set; }
        public ulong ObservedRss { get; private set; }
        public MembershipChangedException(string reasonCode, ulong observedRss) : base(reasonCode) {
            ReasonCode = reasonCode; ObservedRss = observedRss;
        }
    }
    // Discard the whole inconsistent sample, including every retained handle,
    // before retrying. Never hide known hard RSS, OS errors or foreign identity.
    static Sample MeasureStable(Func<Sample> measure) {
        for (int attempt = 1; ; attempt++) {
            try { return measure(); }
            catch (MembershipChangedException error) when (attempt < 3 && error.ObservedRss < HardRssBytes) {
                Thread.Sleep(1);
            }
        }
    }
    static void ValidateMemberSnapshot(uint assigned, uint[] current, HashSet<uint> expected, ulong rss) {
        if (assigned > 1024 || current.Length > 1024) throw new InvalidOperationException("Job membership overflow");
        HashSet<uint> actual = new HashSet<uint>();
        // Reject duplicates in either snapshot before count/set differences can
        // classify it as transient, including simultaneous count and set changes.
        foreach (uint memberPid in current)
            if (!actual.Add(memberPid)) throw new InvalidOperationException("Duplicate job membership");
        if (current.Length > assigned) throw new InvalidOperationException("Invalid job membership count");
        if (current.Length != assigned) throw new MembershipChangedException("membership_incomplete", rss);
        if (expected != null) {
            if (expected.Count != current.Length) throw new MembershipChangedException("membership_count_changed", rss);
            if (!expected.SetEquals(actual)) throw new MembershipChangedException("membership_set_changed", rss);
        }
    }
    static uint[] ReadMemberSnapshot(IntPtr list, HashSet<uint> expected, ulong rss) {
        uint assigned = (uint)Marshal.ReadInt32(list), count = (uint)Marshal.ReadInt32(list, 4);
        // Bound reads before trusting the native list's reported element count.
        if (assigned > 1024 || count > 1024) throw new InvalidOperationException("Job membership overflow");
        uint[] current = new uint[count];
        for (int i = 0; i < count; i++) current[i] = (uint)Marshal.ReadIntPtr(list, 8 + i * IntPtr.Size).ToInt64();
        ValidateMemberSnapshot(assigned, current, expected, rss);
        return current;
    }
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    static GuardianSample MeasureGuardian() {
        // Use this process's own handle; never open a PID supplied by a caller.
        using (Process current = Process.GetCurrentProcess()) {
            long created, exited, kernel, user;
            Check(GetProcessTimes(current.Handle, out created, out exited, out kernel, out user));
            IoCounters io; Check(GetProcessIoCounters(current.Handle, out io));
            MemoryCounters memory = new MemoryCounters(); memory.Size = (uint)Marshal.SizeOf<MemoryCounters>();
            Check(GetProcessMemoryInfo(current.Handle, ref memory, memory.Size));
            UIntPtr affinity, system;
            Check(GetProcessAffinityMask(current.Handle, out affinity, out system));
            uint priority = GetPriorityClass(current.Handle); Check(priority != 0);
            return new GuardianSample { pid=(uint)current.Id, created=created.ToString(System.Globalization.CultureInfo.InvariantCulture), cpuMs=(kernel+user)/10000.0, rssBytes=memory.WorkingSet.ToUInt64(), affinityMask=affinity.ToUInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), priority=priority, writeTransferBytes=io.WriteBytes.ToString(System.Globalization.CultureInfo.InvariantCulture) };
        }
    }

    HostSample MeasureHost() {
        // Direct host counters in this already-constrained guardian: no new
        // probe process or PID-based operation. Kernel ticks include idle.
        long measuredAtMs = hostClock.ElapsedMilliseconds;
        uint groups = GetActiveProcessorGroupCount();
        if (groups != 1) throw new InvalidOperationException("Unsupported host processor groups");
        ulong idle, kernel, user;
        Check(GetSystemTimes(out idle, out kernel, out user));
        HostMemory memory = new HostMemory(); memory.Size = (uint)Marshal.SizeOf<HostMemory>();
        Check(GlobalMemoryStatusEx(ref memory));
        if (idle > kernel || memory.TotalPhysical == 0 || memory.AvailablePhysical > memory.TotalPhysical)
            throw new InvalidOperationException("Invalid host counters");
        lastHostAtMs = measuredAtMs;
        lastHostToken = Guid.NewGuid().ToString("N");
        return new HostSample {
            pid=(uint)Process.GetCurrentProcess().Id, processorGroups=groups, atMs=lastHostAtMs, startToken=lastHostToken,
            idleTicks=idle.ToString(System.Globalization.CultureInfo.InvariantCulture), kernelTicks=kernel.ToString(System.Globalization.CultureInfo.InvariantCulture), userTicks=user.ToString(System.Globalization.CultureInfo.InvariantCulture),
            freeRamBytes=memory.AvailablePhysical, totalRamBytes=memory.TotalPhysical
        };
    }

    public OricaOwnedJob(string executable, string commandLine, string cwd, int threads, int wallMs)
        : this(executable, commandLine, cwd, threads, wallMs, false) { }
    public OricaOwnedJob(string executable, string commandLine, string cwd, int threads, int wallMs, bool watchdog)
        : this(executable, commandLine, cwd, threads, wallMs, watchdog, -1) { }
    public OricaOwnedJob(string executable, string commandLine, string cwd, int threads, int wallMs, bool watchdog, long writeLimit) {
        resourceWatchdogEnabled = watchdog;
        writeTransferLimitBytes = writeLimit;
        if (IntPtr.Size != 8 || GetActiveProcessorGroupCount() != 1)
            throw new InvalidOperationException("Unsupported processor groups/architecture");
        if (threads < 1 || threads > 2 || wallMs < 1 || wallMs > 1200000 || writeLimit < -1 || writeLimit > 2147483648L)
            throw new ArgumentException("Invalid owned process limits");
        IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero;
        bool initialized = false;
        try {
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
            Check(job != IntPtr.Zero);
            safeJob = new SafeJobHandle(job);
            UIntPtr allowed, system;
            Check(GetProcessAffinityMask(Process.GetCurrentProcess().Handle, out allowed, out system));
            ulong mask = 0, bits = allowed.ToUInt64();
            for (int bit = 0, selected = 0; bit < 64 && selected < threads; bit++) {
                ulong candidate = 1UL << bit;
                if ((bits & candidate) != 0) { mask |= candidate; selected++; }
            }
            if (mask == 0) throw new InvalidOperationException("No allowed processors");
            ExtendedLimit limits = new ExtendedLimit();
            // KILL_ON_JOB_CLOSE | AFFINITY | PRIORITY_CLASS | JOB_MEMORY.
            // Job commit ceiling is additional to sampled aggregate RSS.
            limits.Basic.Flags = 0x2000 | 0x10 | 0x20 | 0x200;
            limits.Basic.Affinity = new UIntPtr(mask);
            limits.Basic.Priority = 0x4000; // BELOW_NORMAL_PRIORITY_CLASS
            limits.JobMemory = new UIntPtr(3UL * 1024 * 1024 * 1024);
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimit>()));
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (size.ToInt64() <= 0) throw new InvalidOperationException("Attribute size unavailable");
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
            initialized = true;
            jobList = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobList, job);
            Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x2000D), jobList, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            StartupEx startup = new StartupEx();
            startup.Startup.Size = (uint)Marshal.SizeOf<StartupEx>();
            startup.Attributes = attributes;
            ProcessInfo child;
            // CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT.
            Stopwatch wall = Stopwatch.StartNew();
            Check(CreateProcessW(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x8000000 | 0x80000, IntPtr.Zero, cwd, ref startup, out child));
            root = child.Process; thread = child.Thread; pid = child.Pid;
            bool belongs;
            Check(IsProcessInJob(root, job, out belongs));
            if (!belongs) throw new InvalidOperationException("Atomic job assignment failed");
            long exited, kernel, user;
            Check(GetProcessTimes(root, out rootCreated, out exited, out kernel, out user));
            // Independent of the sampling mutex. SafeHandle keeps the exact job
            // alive across a concurrent Dispose without targeting a reused handle.
            deadline = new Timer(_ => {
                try { if (!TerminateJobObject(safeJob, 124)) deadlineFailed = true; }
                catch (ObjectDisposedException) { /* Last-handle close already kills the job. */ }
            }, null, (int)Math.Max(0, wallMs - wall.ElapsedMilliseconds), Timeout.Infinite);
            if (watchdog) resourceWatchdog = new Timer(_ => ExpireHeartbeat(), null, 100, 100);
            if (writeLimit >= 0) writeWatchdog = new Timer(_ => CheckWriteTransfer(), null, 100, 100);
        } catch { Dispose(); throw; }
        finally {
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
        }
    }
    void EnforceWriteTransfer(ulong transferred) {
        if (writeTransferLimitBytes < 0 || transferred <= (ulong)writeTransferLimitBytes) return;
        Interlocked.Exchange(ref writeTransferLimitExceeded, 1);
        Check(TerminateJobObject(safeJob, 127));
    }
    void CheckWriteTransfer() {
        // Does not wait for the measurement/control mutex or JS heartbeat.
        // SafeHandle pins this exact Job across concurrent shutdown. Class 8
        // retains exited descendants and counts overwrites/deleted output.
        IntPtr data = IntPtr.Zero;
        try {
            data = Marshal.AllocHGlobal(Marshal.SizeOf<AccountingWithIo>());
            Check(QueryInformationJobObject(safeJob, 8, data, (uint)Marshal.SizeOf<AccountingWithIo>(), IntPtr.Zero));
            EnforceWriteTransfer(Marshal.PtrToStructure<AccountingWithIo>(data).Io.WriteBytes);
        } catch (ObjectDisposedException) { /* Last-handle close kills the job. */ }
        catch {
            deadlineFailed = true;
            try { TerminateJobObject(safeJob, 127); } catch (ObjectDisposedException) { }
        } finally { if (data != IntPtr.Zero) Marshal.FreeHGlobal(data); }
    }
    void ExpireHeartbeat() {
        long observed = Volatile.Read(ref heartbeatDeadline);
        if (observed <= 0 || hostClock.ElapsedMilliseconds <= observed) return;
        // A simultaneous fresh acknowledgement wins only before expiration.
        if (Interlocked.CompareExchange(ref heartbeatDeadline, -1, observed) != observed) return;
        Volatile.Write(ref resourceWatchdogExpired, 1);
        try { if (!TerminateJobObject(safeJob, 126)) deadlineFailed = true; }
        catch (ObjectDisposedException) { /* Closing the exact handle already kills the job. */ }
    }
    public void Heartbeat(string hostToken) {
        lock(sync) {
            if (!resourceWatchdogEnabled || !started || disposed || finishing)
                throw new InvalidOperationException("Resource heartbeat not armed");
            long observed = Volatile.Read(ref heartbeatDeadline);
            long now = hostClock.ElapsedMilliseconds;
            if (observed <= 0 || now > observed) {
                ExpireHeartbeat();
                throw new InvalidOperationException("Resource heartbeat expired");
            }
            if (hostToken == null || hostToken != lastHostToken || hostToken == acknowledgedHostToken || now - lastHostAtMs > 3000)
                throw new InvalidOperationException("Missing, replayed or stale resource sample");
            if (Interlocked.CompareExchange(ref heartbeatDeadline, lastHostAtMs + 3000, observed) != observed)
                throw new InvalidOperationException("Resource heartbeat expired concurrently");
            acknowledgedHostToken = hostToken;
        }
    }
    public void Start(string hostToken) {
        lock(sync) {
            if (disposed || started || finishing || deadlineFailed) throw new InvalidOperationException("Job already started/closed or watchdog failed");
            // Bind the actual sample evaluated by the caller, including time
            // spent awaiting the meter and the control channel. The approved
            // two-second cadence allows at most three seconds of sample age.
            long age = hostClock.ElapsedMilliseconds - lastHostAtMs;
            if (lastHostToken == null || hostToken != lastHostToken || age < 0 || age > 3000)
                throw new InvalidOperationException("Missing, replaced or stale pre-start host sample");
            if (resourceWatchdogEnabled) {
                acknowledgedHostToken = hostToken;
                Interlocked.Exchange(ref heartbeatDeadline, lastHostAtMs + 3000);
            }
            if (ResumeThread(thread) == uint.MaxValue) Check(false);
            started = true;
        }
    }
    public void Terminate() { lock(sync) { if (disposed) throw new InvalidOperationException("Closed job"); Check(TerminateJobObject(safeJob, 125)); Interlocked.Exchange(ref heartbeatDeadline, 0); } }
    // Retain the exact job/root handles until the root is signaled and the
    // entire member set has drained. An ACK or a root exit alone is not final
    // descendant accounting. Code 259 can be an actual process exit code.
    public TerminalSample Finish() {
        lock(sync) {
            if (disposed || finishing || deadlineFailed) throw new InvalidOperationException("Job already finishing/closed or watchdog failed");
            finishing = true;
            bool forced = Query<Accounting>(1).Active != 0;
            if (forced) Check(TerminateJobObject(safeJob, 125));
            Stopwatch wait = Stopwatch.StartNew();
            while (wait.ElapsedMilliseconds < 5000) {
                uint state = WaitForSingleObject(root, 0);
                if (state == uint.MaxValue) Check(false);
                if (state != 0 && state != 258) throw new InvalidOperationException("Invalid root wait state");
                if (state == 0 && Query<Accounting>(1).Active == 0) {
                    Interlocked.Exchange(ref heartbeatDeadline, 0);
                    Sample final = Measure();
                    if (final.active != 0 || final.members.Length != 0) throw new InvalidOperationException("Terminal membership changed");
                    return new TerminalSample { sample=final, rootExited=true, forced=forced, jobCpuComplete=true };
                }
                Thread.Sleep(10);
            }
            throw new InvalidOperationException("Owned tree exit unconfirmed");
        }
    }
    void EnforceRss(ulong totalRss) {
        if (totalRss >= HardRssBytes) Check(TerminateJobObject(safeJob, 125));
    }
    T Query<T>(int kind) where T:struct {
        IntPtr data = Marshal.AllocHGlobal(Marshal.SizeOf<T>());
        try { Check(QueryInformationJobObject(job, kind, data, (uint)Marshal.SizeOf<T>(), IntPtr.Zero)); return Marshal.PtrToStructure<T>(data); }
        finally { Marshal.FreeHGlobal(data); }
    }
    public Sample Measure() {
        lock(sync) {
          return MeasureStable(() => {
            if (disposed) throw new InvalidOperationException("Closed job");
            if (deadlineFailed) throw new InvalidOperationException("Watchdog termination failed");
            // Refuse overflow; a changing membership can only produce a fresh,
            // complete retry, never a partial RSS or a reset wall deadline.
            IntPtr list = Marshal.AllocHGlobal(8 + 1024 * IntPtr.Size);
            IntPtr[] handles = null;
            try {
                Check(QueryInformationJobObject(job, 3, list, 8 + 1024 * (uint)IntPtr.Size, IntPtr.Zero));
                uint[] initialIds = ReadMemberSnapshot(list, null, 0);
                uint count = (uint)initialIds.Length;
                Member[] members = new Member[count]; ulong rss = 0;
                handles = new IntPtr[count];
                HashSet<uint> ids = new HashSet<uint>();
                for (int i = 0; i < count; i++) {
                    uint memberPid = initialIds[i];
                    if (!ids.Add(memberPid)) throw new InvalidOperationException("Duplicate job membership");
                    IntPtr handle = OpenProcess(0x400 | 0x10, false, memberPid);
                    Check(handle != IntPtr.Zero);
                    // Retain every handle until the final PID-set check so an
                    // exiting process's PID cannot be recycled during sampling.
                    handles[i] = handle;
                        bool belongs; Check(IsProcessInJob(handle, job, out belongs));
                        if (!belongs) throw new InvalidOperationException("Job member identity changed");
                        long created, exited, kernel, user;
                        Check(GetProcessTimes(handle, out created, out exited, out kernel, out user));
                        MemoryCounters memory = new MemoryCounters(); memory.Size = (uint)Marshal.SizeOf<MemoryCounters>();
                        Check(GetProcessMemoryInfo(handle, ref memory, memory.Size));
                        members[i] = new Member { pid=memberPid, created=created.ToString(System.Globalization.CultureInfo.InvariantCulture), rssBytes=memory.WorkingSet.ToUInt64() };
                        rss = checked(rss + members[i].rssBytes);
                }
                Check(QueryInformationJobObject(job, 3, list, 8 + 1024 * (uint)IntPtr.Size, IntPtr.Zero));
                ReadMemberSnapshot(list, ids, rss);
                // Class 8 includes lifetime I/O of exited descendants, unlike
                // adding counters only for the current member snapshot.
                bool writeExceeded = Volatile.Read(ref writeTransferLimitExceeded) != 0;
                AccountingWithIo accountingWithIo = Query<AccountingWithIo>(8);
                EnforceWriteTransfer(accountingWithIo.Io.WriteBytes);
                writeExceeded |= writeTransferLimitBytes >= 0 && accountingWithIo.Io.WriteBytes > (ulong)writeTransferLimitBytes;
                Accounting accounting = accountingWithIo.Basic;
                if (accounting.Active != count) throw new MembershipChangedException("membership_accounting_changed", rss);
                ExtendedLimit limits = Query<ExtendedLimit>(9);
                uint code; Check(GetExitCodeProcess(root, out code));
                GuardianSample guardian = MeasureGuardian();
                ulong totalRss = checked(rss + guardian.rssBytes);
                // Refuse known aggregate hard RSS even if later policy checks
                // discover another missing measurement. Do not leave the job running.
                EnforceRss(totalRss);
                return new Sample { rootPid=pid, rootCreated=rootCreated.ToString(System.Globalization.CultureInfo.InvariantCulture), active=count, exitCode=code, cpuMs=(accounting.User+accounting.Kernel)/10000.0, writeTransferBytes=accountingWithIo.Io.WriteBytes.ToString(System.Globalization.CultureInfo.InvariantCulture), rssBytes=rss, commitLimitBytes=limits.JobMemory.ToUInt64(), members=members, affinityMask=limits.Basic.Affinity.ToUInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), priority=limits.Basic.Priority, guardian=guardian, totalCpuMs=(accounting.User+accounting.Kernel)/10000.0 + guardian.cpuMs, totalRssBytes=totalRss, host=MeasureHost(), resourceWatchdogEnabled=resourceWatchdogEnabled, resourceWatchdogExpired=Volatile.Read(ref resourceWatchdogExpired) != 0, writeTransferLimitBytes=writeTransferLimitBytes, writeTransferLimitExceeded=writeExceeded };
            } finally {
                if (handles != null) foreach (IntPtr handle in handles) if (handle != IntPtr.Zero) CloseHandle(handle);
                Marshal.FreeHGlobal(list);
            }
          });
        }
    }
    public void Dispose() {
        lock(sync) {
            if (disposed) return;
            disposed = true;
            Interlocked.Exchange(ref heartbeatDeadline, 0);
            if (resourceWatchdog != null) resourceWatchdog.Dispose();
            if (writeWatchdog != null) writeWatchdog.Dispose();
            if (deadline != null) deadline.Dispose();
            // Also cover a failed post-create membership check with the exact
            // process handle returned by CreateProcess, never a recycled PID.
            if (root != IntPtr.Zero) TerminateProcess(root, 125);
            // Non-inheritable unnamed last handle closes the entire descendant job.
            if (safeJob != null) safeJob.Dispose();
            if (thread != IntPtr.Zero) CloseHandle(thread);
            if (root != IntPtr.Zero) CloseHandle(root);
            job = root = thread = IntPtr.Zero;
        }
    }
}
