export function mostrarModalValidacion(errores) {
  const backdrop = document.getElementById("val-modal");
  const list = document.getElementById("val-modal-list");

  if (!backdrop || !list) return;

  list.innerHTML = "";

  errores.forEach(err => {
    const li = document.createElement("li");
    li.textContent = err;
    list.appendChild(li);
  });

  backdrop.style.display = "flex";

  setTimeout(() => {
    backdrop.classList.add("show");
  }, 10);
}

export function cerrarModalValidacion() {
  const backdrop = document.getElementById("val-modal");
  if (!backdrop) return;

  backdrop.classList.remove("show");

  setTimeout(() => {
    backdrop.style.display = "none";
  }, 300);
}

export function registrarModalValidacionGlobal() {
  window.mostrarModalValidacion = mostrarModalValidacion;
  window.cerrarModalValidacion = cerrarModalValidacion;
}
