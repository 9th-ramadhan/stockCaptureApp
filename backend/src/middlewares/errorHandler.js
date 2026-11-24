/**
 * Centralized Error Handling & Not Found Middleware
 * Terinspirasi dari Exception Handler pada Laravel (App\Exceptions\Handler)
 */

/**
 * Middleware untuk menangani request ke endpoint yang tidak terdaftar (404)
 */
export function notFoundHandler(req, res) {
  return res.status(404).json({
    status: 'error',
    message: `Rute API ${req.method} ${req.originalUrl} tidak ditemukan`,
  });
}

/**
 * Middleware penanganan error terpusat
 * Menangkap seluruh error dari controller dan menormalkannya ke format respons JSON standar
 */
export function errorHandler(err, req, res, next) {
  const isAuthError =
    err.isAuthError ||
    (typeof err.message === 'string' &&
      (err.message.includes('cookies.json') ||
        err.message.includes('login') ||
        err.message.includes('Sesi') ||
        err.message.includes('autentikasi')));

  const statusCode = err.statusCode || err.status || (isAuthError ? 401 : 500);

  let defaultMessage = 'Terjadi kesalahan internal pada server';
  if (isAuthError) {
    defaultMessage = 'Sesi akun Stockbit (cookies.json) diperlukan untuk mengakses fitur ini.';
  }

  const message = err.customMessage || defaultMessage;

  console.error(`❌ [Centralized Error] [${req.method} ${req.originalUrl}] [${statusCode}]:`, err.message || err);

  return res.status(statusCode).json({
    status: 'error',
    requiresLogin: isAuthError,
    message,
    error: err.message || String(err),
  });
}
