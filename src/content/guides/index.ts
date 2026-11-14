import type { DeviceGuide } from '../device-guide';
import type { GuideId } from '../site';
import { SOMFY_RTS_GUIDE } from './somfy-rts';
import { TOSHIBA_AC_GUIDE } from './toshiba-ac';
import { VELUX_GUIDE } from './velux';

export const GUIDES: Readonly<Record<GuideId, DeviceGuide>> = {
  'guide-velux': VELUX_GUIDE,
  'guide-toshiba-ac': TOSHIBA_AC_GUIDE,
  'guide-somfy-rts': SOMFY_RTS_GUIDE,
};
