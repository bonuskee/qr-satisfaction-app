import { escapeHtml } from "../utils.ts";

export function QRModal(survey) {
  const encodedId = encodeURIComponent(survey.id);
  const safeId = escapeHtml(encodedId);
  const modal = document.createElement("div");
  modal.className = "qr-modal";
  modal.innerHTML = `
    <div class="qr-modal__panel" role="dialog" aria-modal="true" aria-label="QR Code">
      <button class="qr-modal__close" data-close aria-label="ปิด">×</button>
      <h2>${escapeHtml(survey.title)}</h2>
      <p>${escapeHtml(survey.branch)}</p>
      <img src="/api/qr/${safeId}" alt="QR Code สำหรับ ${escapeHtml(survey.title)}" />
      <code>${escapeHtml(location.origin)}/respond/${safeId}</code>
      <a class="button button--primary" href="/respond/${safeId}">เปิดหน้าตอบแบบสำรวจ</a>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close]")) modal.remove();
  });
  document.body.appendChild(modal);
}
