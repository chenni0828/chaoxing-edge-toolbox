import { mountToolboxLauncher } from '../features/floating-toolbox/launcher-ui';

const dispose = mountToolboxLauncher(document.body);
window.addEventListener('unload', dispose, { once: true });
