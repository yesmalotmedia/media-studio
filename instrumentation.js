// Next.js server-boot hook (see next.config.js experimental.instrumentationHook).
// register() runs once when the server starts — this is where the auto-ingest
// folder watcher (lib/ingest.js) gets kicked off, so it runs for the whole
// lifetime of the app without needing a separate process.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestWatcher } = await import('./lib/ingest.js');
    startIngestWatcher();
  }
}
