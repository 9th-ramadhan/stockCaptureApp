import { executeHybridTask } from './runnerHelper.js';
import { captureOrderbookSnapshotOnly } from '../services/puppeteerService.js';

executeHybridTask({
  taskTitle: '📸 Memulai Capture Snapshot Orderbook Terakhir',
  logFileName: 'orderbook_stream.log',
  apiEndpoint: '/api/capture/orderbook',
  requestBody: { headless: true },
  inProcessFn: async () => {
    return await captureOrderbookSnapshotOnly([], { headless: true });
  },
});
