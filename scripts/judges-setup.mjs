import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, CONFIG, appPort, assertDependencies, createConfig, executable, python311, run } from './judges-common.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run judges:setup -- (--public-url https://YOUR-ASSIGNED-DOMAIN | --local-only) [--port 8789] [--install-prerequisites]\nInstalls speech dependencies into speech/.venv. The optional flag installs missing Homebrew prerequisites; it never creates a paid service or authenticates an account.');
  process.exit(0);
}

try {
  const known = new Set(['--public-url', '--port', '--install-prerequisites', '--local-only']);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw Error(`Unknown option ${args[index]}. Use --help.`);
    if (args[index] === '--install-prerequisites') options.install = true;
    else if (args[index] === '--local-only') options.localOnly = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error('A setup option is missing its value. Use --help.');
      options[args[index - 1] === '--public-url' ? 'url' : 'port'] = value;
    }
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('This launcher targets an Apple Silicon Mac running native ARM Node. Open a native terminal and use ARM Node before setup.');
  assertDependencies();
  const disk = await statfs(ROOT);
  const installed = existsSync(path.join(ROOT, 'speech/.venv/bin/python'));
  const minimumGiB = installed ? 3 : 7;
  if (disk.bavail * disk.bsize < minimumGiB * 1024 ** 3) throw Error(`Free at least ${minimumGiB} GiB for ${installed ? 'the speech model cache and builds' : 'the isolated Python environment, model and build'} before setup.`);
  let python;
  try { python = python311(); } catch (error) {
    if (!options.install) throw error;
    const brew = executable('brew');
    if (!brew) throw Error('Install Homebrew yourself first, then rerun setup with --install-prerequisites.');
    run(brew, ['install', 'python@3.11']);
    python = python311();
  }
  if (!options.localOnly && !executable('ngrok')) {
    if (!options.install) throw Error('ngrok is missing. Install the free ngrok agent yourself, or rerun setup with --install-prerequisites.');
    const brew = executable('brew');
    if (!brew) throw Error('Install Homebrew yourself first, then rerun setup with --install-prerequisites.');
    run(brew, ['install', 'ngrok/ngrok/ngrok']);
  }
  const origin = options.url || process.env.JUDGES_PUBLIC_URL;
  if (!origin && !options.localOnly) throw Error('Copy the assigned URL from your free ngrok account and rerun with --public-url https://YOUR-ASSIGNED-DOMAIN, or use --local-only for local testing.');
  const port = options.port === undefined ? undefined : appPort(options.port);
  if (!existsSync(path.join(ROOT, 'speech/requirements.txt'))) throw Error('The speech service source is missing from this checkout.');
  const venv = path.join(ROOT, 'speech/.venv/bin/python');
  if (!existsSync(venv)) run(python, ['-m', 'venv', 'speech/.venv']);
  run(venv, ['-c', 'import platform,sys; assert sys.version_info[:2] == (3,11) and platform.machine() == "arm64", "Remove speech/.venv and rerun setup with native ARM Python 3.11."']);
  run(venv, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'speech/requirements.txt']);
  run(venv, ['-m', 'pip', 'check']);
  const config = await createConfig(origin, port, { localOnly: options.localOnly });
  console.log(`Setup complete. Private config: ${path.relative(ROOT, CONFIG)}\nApp port: ${config.port}. Speech model download and warmup happen on the first run.\n${options.localOnly ? 'Run npm run judges:start -- --local-only. No account or public URL is needed for this local check.' : 'Authenticate ngrok in your own terminal if you have not already: ngrok config add-authtoken YOUR_TOKEN\nThen run npm run judges:start. The live URL is printed only after all services pass readiness checks.'}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
