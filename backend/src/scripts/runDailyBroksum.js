import { executeHybridTask } from './runnerHelper.js';
import { captureBrokerSummaryOnly } from '../services/puppeteerService.js';

executeHybridTask({
  taskTitle: '📊 Memulai Jadwal Harian: Capture Broker Summary (Final)',
  logFileName: 'daily_broksum.log',
  apiEndpoint: '/api/capture/broksum',
  requestBody: { headless: true },
  inProcessFn: async () => {
    return await captureBrokerSummaryOnly([], { headless: true });
  },
});
