// Licensed under GPLv3. See NOTICE for the Section 7(b) attribution terms.
import { mountToolboxLauncher } from '../features/floating-toolbox/launcher-ui';
import { showPopupUpdateNotice } from '../features/update-check/ui';

const dispose = mountToolboxLauncher(document.body);
window.addEventListener('unload', dispose, { once: true });

// 更新服务暂不可用时，弹窗继续提供原有的页面操作。
void showPopupUpdateNotice(document).catch(() => {});
