// Private helper initialization only. No PID, target handle or renewal API.
using System;
using System.Diagnostics;
using System.Threading;

public sealed class OricaBootstrapLease : IDisposable {
    readonly object sync = new object();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly Timer timer;
    const long DeadlineMs = 15000;
    bool closed;

    public OricaBootstrapLease() {
        timer = new Timer(_ => Check(), null, 100, 100);
    }
    void Check() {
        lock(sync) {
            if (!closed && clock.ElapsedMilliseconds >= DeadlineMs)
                Environment.Exit(127);
        }
    }
    // Install the existing lifetime guard before completing initialization.
    // A late completion is rejected even if the timer callback is delayed.
    public void Complete() {
        lock(sync) {
            if (closed || clock.ElapsedMilliseconds >= DeadlineMs)
                throw new InvalidOperationException("Bootstrap lease expired/closed");
            closed = true;
            timer.Dispose();
        }
    }
    public void Dispose() {
        lock(sync) {
            if (closed) return;
            closed = true;
            timer.Dispose();
        }
    }
}
