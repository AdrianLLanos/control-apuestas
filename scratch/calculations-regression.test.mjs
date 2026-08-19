import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// El proyecto no declara `type: module`; cargar el módulo por data URL permite
// ejecutar esta prueba sin alterar su configuración de producción.
const source = readFileSync(new URL("../script/calculations.js", import.meta.url), "utf8");
const calculations = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { calcularDetalleSistema, determinarResultadoSistema, calcularCuotaMaximaSistema } = calculations;

// Un push es un resultado definitivo: nunca debe degradarse a pendiente ni
// eliminarse de la cuota de un sistema.
const apuesta = {
  tipoApuesta: "sistema",
  importe: 12,
  sistemaStakes: { 2: 2 },
  jugadas: [
    { c: 1.55, selections: [{ estado: "nula" }] },
    { c: 1.44, selections: [{ estado: "ganada" }] },
    { c: 1.41, selections: [{ estado: "ganada" }] },
    { c: 1.55, selections: [{ estado: "ganada" }] }
  ]
};

assert.equal(determinarResultadoSistema(apuesta), "ganada");
assert.equal(calcularCuotaMaximaSistema(apuesta.jugadas, apuesta.sistemaStakes), 1.8079833333);
assert.equal(calcularDetalleSistema(apuesta).retorno, 21.6958);

console.log("OK: los pushes MLB conservan su estado y su efecto en el sistema.");
