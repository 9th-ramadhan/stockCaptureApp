import { executeHybridTask } from './runnerHelper.js';
import { captureWatchlistWorkflow } from '../services/puppeteerService.js';
import { saveStockCapture } from '../models/stockModel.js';

executeHybridTask({
  taskTitle: '⏰ Memulai Jadwal Harian: Capture Watchlist Stockbit',
  logFileName: 'daily_capture.log',
  apiEndpoint: '/api/capture/watchlist',
  requestBody: { headless: true },
  inProcessFn: async () => {
    return await captureWatchlistWorkflow({
      headless: true,
      onStockCaptured: async (stockData) => saveStockCapture(stockData),
    });
  },
});
