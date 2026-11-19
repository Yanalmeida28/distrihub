// Non-transport suites keep their existing channel fakes. The real auth/retry
// boundary is exercised separately in authenticated-realtime.test.mjs.
export const realtimeTransport = { authenticatedRealtime(client, createChannel, options = {}) {
  const channel = createChannel(); channel.subscribe(options.onStatus);
  return () => { void client.removeChannel(channel); };
} };
