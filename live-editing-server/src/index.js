import { config } from './config.js';
import { createLiveServer } from './server.js';

const log = (...args) => console.log(new Date().toISOString(), ...args);

const live = createLiveServer({ log });

await live.listen(config.port);
log(`live editing server on :${config.port}`);
log(config.allowAnyOrigin
    ? 'origins: any (development only)'
    : `origins: ${[...config.allowedOrigins].join(', ')}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        log('shutting down');
        for (const ws of live.wss.clients) ws.close(1001, 'server shutting down');
        setTimeout(() => process.exit(0), 2000).unref?.();
        await live.close();
        process.exit(0);
    });
}
