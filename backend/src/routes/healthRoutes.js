import { Router } from 'express';
import { handleHealthCheck, handleDbCheck } from '../controllers/healthController.js';

const router = Router();

// Endpoint Health Check Server
router.get('/health', handleHealthCheck);

// Endpoint Tes Koneksi Database MySQL
router.get('/db-check', handleDbCheck);

export default router;
