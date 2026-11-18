// A transport lease for these private helper processes only. It never opens a
// PID or terminates another process. OS handle close drains the guardian job.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public sealed class OricaControlLease : IDisposable {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint WaitForSingleObject(SafeProcessHandle process, uint ms);
    readonly object sync = new object();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly SafeProcessHandle target;
    readonly Timer timer;
    // Five seconds is transport cleanup grace, not a resource heartbeat or a
    // renewed wall budget. The existing three-second resource watchdog remains.
    const long GraceMs = 5000;
    long expiresAt;
    bool disposed;

    public OricaControlLease() : this(null) { }
    public OricaControlLease(SafeProcessHandle retainedTarget) {
        target = retainedTarget;
        expiresAt = target == null ? GraceMs : 0;
        timer = new Timer(_ => Check(), null, 100, 100);
    }
    public void Touch() {
        lock(sync) {
            long now = clock.ElapsedMilliseconds;
            if (target != null || disposed || now >= expiresAt)
                throw new InvalidOperationException("Control lease expired/closed");
            expiresAt = now + GraceMs;
        }
    }
    void Check() {
        // This mutex is independent of native sampling/measurement and stdin.
        lock(sync) {
            if (disposed) return;
            long now = clock.ElapsedMilliseconds;
            if (target != null && expiresAt == 0) {
                uint result = WaitForSingleObject(target, 0);
                if (result == 258) return;
                // Failed retained-handle observation is not a live target.
                if (result != 0) { Environment.Exit(127); return; }
                expiresAt = now + GraceMs;
            }
            if (now >= expiresAt) Environment.Exit(127);
        }
    }
    public void Dispose() {
        lock(sync) {
            if (disposed) return;
            disposed = true;
            timer.Dispose();
        }
    }
}
