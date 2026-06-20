import { clearSurveyResponses, deleteSurvey, toggleSurvey } from "../api.ts";
import { escapeHtml } from "../utils.ts";

const moods = {
  1: { emoji: "😠", label: "ไม่พอใจ" },
  2: { emoji: "🙁", label: "ควรปรับปรุง" },
  3: { emoji: "😐", label: "ปานกลาง" },
  4: { emoji: "🙂", label: "ดี" },
  5: { emoji: "😄", label: "ดีมาก" }
};

document.addEventListener("pointerdown", (event) => {
  document.querySelectorAll("[data-menu-panel]:not([hidden])").forEach((panel) => {
    const menu = panel.closest("[data-menu]");
    if (menu?.contains(event.target)) return;
    panel.hidden = true;
    menu?.querySelector("[data-menu-trigger]")?.setAttribute("aria-expanded", "false");
  });
});

export function SurveyCard(container, survey, actions) {
  const article = document.createElement("article");
  article.className = "survey-card";
  render(survey);

  function render(currentSurvey) {
    const maxCount = Math.max(1, ...currentSurvey.distribution.map((item) => item.count));
    article.innerHTML = `
      <div class="survey-card__main">
        <div>
          <div class="survey-card__title-row">
            <h2>${escapeHtml(currentSurvey.title)}</h2>
            <span class="status status--${currentSurvey.status}">${currentSurvey.status === "open" ? "เปิดรับ" : "ปิด"}</span>
          </div>
          <p>${escapeHtml(currentSurvey.branch)}</p>
          <div class="survey-card__meta">
            <span class="meta meta--chat">${currentSurvey.responses} คำตอบ</span>
            <span class="meta meta--star">เฉลี่ย ${currentSurvey.average}/5</span>
          </div>
        </div>
        <div class="survey-card__actions">
          <button class="button button--qr" data-qr><span class="tiny-qr" aria-hidden="true"></span> QR Code</button>
          <button
            class="button button--status-toggle button--status-toggle--${currentSurvey.status === "open" ? "close" : "open"}"
            type="button"
            data-toggle
          >${currentSurvey.status === "open" ? "ปิดรับ" : "เปิดรับ"}</button>
          <div class="action-menu" data-menu>
            <button
              class="action-menu__trigger"
              type="button"
              aria-label="เปิดเมนูจัดการแบบสำรวจ"
              aria-expanded="false"
              aria-haspopup="menu"
              title="จัดการแบบสำรวจ"
              data-menu-trigger
            >⋮</button>
            <div class="action-menu__panel" role="menu" data-menu-panel hidden>
              <button type="button" role="menuitem" data-responses>ดูคำตอบ</button>
              <button type="button" role="menuitem" class="action-menu__edit" data-edit>แก้ไข</button>
              <button type="button" role="menuitem" class="action-menu__clear" data-clear>ล้างคำตอบ</button>
              <button type="button" role="menuitem" class="action-menu__danger" data-delete>ลบฟอร์ม</button>
            </div>
          </div>
        </div>
      </div>
      <div class="rating-bars">
        ${currentSurvey.distribution
          .map(
            (item) => `
              <div class="rating-bar">
                <span>${item.count}</span>
                <div class="rating-bar__track rating-bar__track--${item.rating}" style="height:${Math.max(
                  7,
                  Math.round((item.count / maxCount) * 26)
                )}px"></div>
                <small title="${moods[item.rating].label}">${moods[item.rating].emoji}</small>
              </div>
            `
          )
          .join("")}
      </div>
    `;

    const menu = article.querySelector("[data-menu]");
    const menuTrigger = article.querySelector("[data-menu-trigger]");
    const menuPanel = article.querySelector("[data-menu-panel]");

    function closeMenu() {
      menuPanel.hidden = true;
      menuTrigger.setAttribute("aria-expanded", "false");
    }

    menuTrigger.addEventListener("click", () => {
      const willOpen = menuPanel.hidden;
      document.querySelectorAll("[data-menu-panel]:not([hidden])").forEach((panel) => {
        panel.hidden = true;
        panel.closest("[data-menu]")?.querySelector("[data-menu-trigger]")?.setAttribute("aria-expanded", "false");
      });
      menuPanel.hidden = !willOpen;
      menuTrigger.setAttribute("aria-expanded", String(willOpen));
    });
    menu.addEventListener("focusout", (event) => {
      if (!menu.contains(event.relatedTarget)) closeMenu();
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        menuTrigger.focus();
      }
    });

    article.querySelector("[data-responses]").addEventListener("click", () => {
      closeMenu();
      actions.onResponses();
    });
    article.querySelector("[data-qr]").addEventListener("click", actions.onQr);
    article.querySelector("[data-edit]").addEventListener("click", () => {
      closeMenu();
      actions.onEdit();
    });
    article.querySelector("[data-clear]").addEventListener("click", async () => {
      closeMenu();
      if (!confirm(`ล้างคำตอบของ "${currentSurvey.title}"?`)) return;
      const updatedSurvey = await clearSurveyResponses(currentSurvey.id);
      actions.onUpdated(updatedSurvey);
    });
    article.querySelector("[data-delete]").addEventListener("click", async () => {
      closeMenu();
      if (!confirm(`ลบแบบฟอร์ม "${currentSurvey.title}" และคำตอบทั้งหมดอย่างถาวร?`)) return;
      const updatedDashboard = await deleteSurvey(currentSurvey.id);
      actions.onDeleted(updatedDashboard);
    });
    article.querySelector("[data-toggle]").addEventListener("click", async () => {
      closeMenu();
      const updatedSurvey = await toggleSurvey(currentSurvey.id);
      actions.onUpdated(updatedSurvey);
    });
  }

  container.appendChild(article);
}
