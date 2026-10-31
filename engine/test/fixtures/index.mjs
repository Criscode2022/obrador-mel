// Negocios inventados para probar las reservas: el obrador solo usa pedidos e información, pero el
// motor también sabe reservar mesa y dar cita con profesional. No son demos: solo existen aquí.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBusiness } from '../../biz/store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const restaurante = () => loadBusiness(path.join(here, 'restaurante-prueba'));
export const peluqueria = () => loadBusiness(path.join(here, 'peluqueria-prueba'));
