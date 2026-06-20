import { createSurvey, submitResponse, updateSurvey } from "../api.ts";
import { escapeHtml } from "../utils.ts";

const moods = [
  { rating: 1, label: "ไม่พอใจ", color: "#c43d36" },
  { rating: 2, label: "ควรปรับปรุง", color: "#e0772f" },
  { rating: 3, label: "ปานกลาง", color: "#b18409" },
  { rating: 4, label: "ดี", color: "#5ca83a" },
  { rating: 5, label: "ดีมาก", color: "#1f8a4c" }
];

export function SurveyForm(container, options = {}) {
  const responseMode = Boolean(options.responseMode);
  const editMode = Boolean(options.editMode);
  const survey = options.survey || {};
  container.innerHTML = responseMode ? responseMarkup(survey) : createMarkup(survey, editMode);

  const form = container.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;

    try {
      if (responseMode) {
        await submitResponse({
          surveyId: survey.id,
          rating: Number(data.rating),
          comment: data.comment || ""
        });
      } else if (editMode) {
        await updateSurvey(survey.id, {
          title: data.title,
          branch: data.branch
        });
      } else {
        await createSurvey({
          title: data.title,
          branch: data.branch
        });
      }
      options.onSaved?.();
    } catch (error) {
      form.querySelector("[data-error]").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function createMarkup(survey = {}, editMode = false) {
  return `
    <section class="form-card">
      <h2>${editMode ? "แก้ไขแบบสำรวจ" : "สร้างแบบสำรวจ"}</h2>
      <form>
        <label>
          ชื่อแบบสำรวจ
          <input name="title" value="${escapeHtml(survey.title || "")}" maxlength="120" placeholder="ชื่อแบบสำรวจ" required />
        </label>
        <label>
          สาขาหรือแผนก
          <input name="branch" value="${escapeHtml(survey.branch || "")}" maxlength="120" placeholder="สาขาหรือแผนก" required />
        </label>
        <p class="form-error" data-error></p>
        <button class="button button--primary" type="submit">${editMode ? "บันทึกการแก้ไข" : "บันทึกแบบสำรวจ"}</button>
      </form>
    </section>
  `;
}

function responseMarkup(survey) {
  return `
    <section class="form-card form-card--respond">
      <p class="form-kicker">แบบสำรวจความพึงพอใจ</p>
      <h2>${escapeHtml(survey.title)}</h2>
      <span>${escapeHtml(survey.branch)}</span>
      <form>
        <fieldset class="rating-input">
          <legend>เลือกความพึงพอใจ</legend>
          ${moods
            .map(
              (mood) => `
                <label style="--mood-color:${mood.color}">
                  <input type="radio" name="rating" value="${mood.rating}" required />
                  <span class="rating-option">
                    <span class="mood-face mood-face--${mood.rating}" aria-hidden="true"></span>
                    <small>${mood.label}</small>
                  </span>
                </label>
              `
            )
            .join("")}
        </fieldset>
        <label>
          ความคิดเห็นเพิ่มเติม
          <textarea name="comment" rows="4" maxlength="2000" placeholder="ความคิดเห็นเพิ่มเติม"></textarea>
        </label>
        <p class="form-error" data-error></p>
        <button class="button button--primary" type="submit">ส่งคำตอบ</button>
      </form>
    </section>
  `;
}
