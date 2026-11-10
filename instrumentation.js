// Next.js server-boot hook (see next.config.js experimental.instrumentationHook).
// register() runs once when the server starts — this is where the auto-ingest
// folder watcher (lib/ingest.js) gets kicked off, so it runs for the whole
// lifetime of the app without needing a separate process.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestWatcher } = await import('./lib/ingest.js');
    startIngestWatcher();
    // Maalot website posts once a lesson's YouTube video goes public (lib/publishWatch.js)
    const { startPublishWatcher } = await import('./lib/publishWatch.js');
    startPublishWatcher();
    // the short lessons: folder -> scheduled YouTube upload -> podcast/website once public (lib/shorts.js)
    const { startShortsWatcher } = await import('./lib/shorts.js');
    startShortsWatcher();
    // sources text in a new row's notes -> PDF on Drive + link in column E (lib/sourcesWatch.js)
    const { startSourcesWatcher } = await import('./lib/sourcesWatch.js');
    startSourcesWatcher();
    // transcript, summaries and sources of a lesson once its website post exists (lib/aiWatch.js; off unless config.json ai.enabled)
    const { startAiWatcher } = await import('./lib/aiWatch.js');
    startAiWatcher();
  }
}
