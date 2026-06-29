const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/b2bOnboardingController');

// Enviar invitación de onboarding por WhatsApp
router.post('/invitar', onboardingController.invitarCliente);

// Validar token de invitación (cuando el cliente entra con el enlace)
router.get('/validar-token', onboardingController.validarToken);

// Registrar correo y contraseña para crear la cuenta
router.post('/completar-onboarding', onboardingController.completarOnboarding);

// Solicitar código OTP por WhatsApp (autoservicio)
router.post('/otp/solicitar', onboardingController.solicitarOtp);

// Verificar el código OTP e iniciar el onboarding
router.post('/otp/verificar', onboardingController.verificarOtp);

// Acceso maestro espejo (bypass de login para administrador)
router.get('/acceso-maestro/:clienteId', onboardingController.accesoMaestro);

module.exports = router;
