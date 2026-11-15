import type { Comparison } from '../compare-page';
import type { CompareId } from '../site';
import { GOOGLE_HOME_COMPARISON } from './google-home';
import { HOME_ASSISTANT_COMPARISON } from './home-assistant';
import { HOMEY_COMPARISON } from './homey';
import { JEEDOM_COMPARISON } from './jeedom';

export const COMPARISONS: Readonly<Record<CompareId, Comparison>> = {
  'compare-home-assistant': HOME_ASSISTANT_COMPARISON,
  'compare-jeedom': JEEDOM_COMPARISON,
  'compare-homey': HOMEY_COMPARISON,
  'compare-google-home': GOOGLE_HOME_COMPARISON,
};
