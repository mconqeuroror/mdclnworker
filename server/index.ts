// Production entry point - directly imports the server (no child processes!)
// In production (dist/), this gets bundled with the server code
// In development, it runs the source version via tsx

import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve, normalize } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// pid2 watchdog pinger
// Replit's pid2 process manager kills the process with SIGKILL after ~22s
// if it doesn't receive a connection on /run/replit/socks/pid2ping.0.sock.
// We keep a persistent connection to that socket so pid2 knows we're alive.
// ---------------------------------------------------------------------------
const PID2_PING_SOCK = '/run/replit/socks/pid2ping.0.sock';
const isVercel = process.env.VERCEL === '1';

function connectToPid2Pinger() {
  if (isVercel || !existsSync(PID2_PING_SOCK)) return;

  const sock = net.createConnection(PID2_PING_SOCK);

  sock.on('connect', () => {
    console.log('[pid2] watchdog connected — server will not be idle-killed');
    // Send a ping byte immediately
    sock.write(Buffer.from([0x00]));
  });

  // If connection drops, reconnect after 5s
  sock.on('close', () => {
    console.log('[pid2] watchdog socket closed — reconnecting in 5s');
    setTimeout(connectToPid2Pinger, 5000);
  });

  sock.on('error', (err) => {
    console.log(`[pid2] watchdog error: ${err.message} — retrying in 5s`);
    setTimeout(connectToPid2Pinger, 5000);
  });

  // Send a heartbeat ping every 10 seconds to keep the watchdog happy
  const pingInterval = setInterval(() => {
    if (!sock.destroyed) {
      sock.write(Buffer.from([0x00]));
    } else {
      clearInterval(pingInterval);
    }
  }, 10000);
}

connectToPid2Pinger();

// ---------------------------------------------------------------------------
// Error / signal handlers
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.log('💥 UNCAUGHT EXCEPTION:', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('💥 UNHANDLED REJECTION:', reason);
});

// Trap SIGTERM: log to stdout and do NOT exit.
// Node.js exits on SIGTERM by default; adding a handler prevents that.
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received — ignoring, keeping server alive');
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received');
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
console.log('🚀 Starting ModelClone backend...\n');
console.log(`📍 Working directory: ${process.cwd()}`);
console.log(`🔧 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
// Backend must not bind to a frontend port: prefer SERVER_PORT, else PORT, else 5000. Set PORT so the loaded server uses it.
const serverPort = process.env.SERVER_PORT || process.env.PORT || '5000';
process.env.PORT = String(serverPort);
console.log(`🔌 PORT: ${serverPort}`);
console.log('');

async function bootstrap(): Promise<void> {
  // Production: require DATABASE_URL (except on Vercel where env is set in Dashboard), then schema sync (skipped on Vercel)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL?.trim()) {
      console.error('❌ DATABASE_URL is missing in production.');
      if (isVercel) {
        console.error('   On Vercel: set env vars in Dashboard → Project → Settings → Environment Variables (DATABASE_URL, JWT_SECRET, etc.).');
      } else {
        console.error('   Set the database secret and redeploy.');
      }
      process.exit(1);
    }
    // On Vercel (serverless) skip DB sync and rename — run migrations elsewhere. On Replit/VM run them at startup.
    if (!isVercel) {
      try {
        const { stdout, stderr } = await execAsync('node scripts/rename-crypto-oderId-to-orderId.js');
        if (stdout?.trim()) console.log(stdout.trim());
        if (stderr?.trim()) console.warn(stderr.trim());
      } catch (renameErr: unknown) {
        const msg = renameErr instanceof Error ? renameErr.message : String(renameErr);
        console.warn('⚠️ CryptoPayment column rename skip (non-fatal):', msg);
      }
      if (process.env.SKIP_DB_PUSH === '1') {
        console.warn('⚠️ SKIP_DB_PUSH=1: skipping schema sync (fix DB manually then remove this env var)');
      } else {
        console.log('🔄 Syncing database schema...');
        try {
          const { stdout, stderr } = await execAsync('npx prisma db push --skip-generate');
          console.log(stdout);
          if (stderr) {
            console.warn('Schema sync warnings:', stderr);
          }
          console.log('✅ Database schema synced\n');
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('❌ Schema sync failed:', errorMessage);
          console.error('To start the server anyway, set env SKIP_DB_PUSH=1, then fix the DB (e.g. rename CryptoPayment.oderId to orderId) and redeploy without SKIP_DB_PUSH.');
          process.exit(1);
        }
      }
    } else {
      console.log('⏭️ Vercel: skipping DB sync at startup (run prisma migrate/deploy separately if needed).');
    }
  }

  // Resolve server entry: production bundle (dist/production.js) or source (src/server.js). Use resolve+normalize so paths work on Windows (dev) and Linux (deploy).
  const bundledProduction = resolve(__dirname, 'production.js');
  const sourceServer = resolve(__dirname, '..', 'src', 'server.js');
  const bundledPath = normalize(bundledProduction);
  const sourcePath = normalize(sourceServer);

  if (existsSync(bundledPath)) {
    console.log('📦 Running bundled production server...');
    await import(pathToFileURL(bundledPath).href);
  } else {
    console.log('🔨 Running development server...');
    await import(pathToFileURL(sourcePath).href);
  }
}

bootstrap().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error('💥 Bootstrap failed:', msg);
  process.exit(1);
});
