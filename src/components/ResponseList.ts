import { escapeHtml } from "../utils.ts";

const moods = {
  1: { emoji: "😠", label: "ไม่พอใจ" },
  2: { emoji: "🙁", label: "ควรปรับปรุง" },
  3: { emoji: "😐", label: "ปานกลาง" },
  4: { emoji: "🙂", label: "ดี" },
  5: { emoji: "😄", label: "ดีมาก" }
};

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short"
});

export function ResponseList(container, data, actions) {
  const { survey, responses } = data;
  container.innerHTML = `
    <section class="responses-page">
      <header class="responses-header">
        <button class="back-button responses-header__back" data-back>กลับแดชบอร์ด</button>
        <div>
          <p>คำตอบของแบบสำรวจ</p>
          <h1>${escapeHtml(survey.title)}</h1>
          <span>${escapeHtml(survey.branch)}</span>
        </div>
        <div class="responses-summary">
          <strong>${survey.responses}</strong>
          <span>คำตอบทั้งหมด</span>
          <b>เฉลี่ย ${survey.average}/5</b>
        </div>
      </header>
      ${responses.length ? responseTable(responses) : emptyState()}
    </section>
  `;

  container.querySelector("[data-back]").addEventListener("click", actions.onBack);
}

function responseTable(responses) {
  return `
    <div class="responses-table-wrap">
      <table class="responses-table">
        <thead>
          <tr>
            <th>ระดับความพึงพอใจ</th>
            <th>ความคิดเห็น</th>
            <th>อุปกรณ์</th>
            <th>วันและเวลา</th>
          </tr>
        </thead>
        <tbody>
          ${responses
            .map((response) => {
              const mood = moods[response.rating] || moods[3];
              return `
                <tr>
                  <td data-label="ระดับ">
                    <span class="response-mood response-mood--${response.rating}">
                      <strong>${mood.emoji}</strong>
                      <span>${escapeHtml(mood.label)} · ${response.rating}/5</span>
                    </span>
                  </td>
                  <td data-label="ความคิดเห็น" class="response-comment">${
                    response.comment ? escapeHtml(response.comment) : '<span class="muted">ไม่มีความคิดเห็น</span>'
                  }</td>
                  <td data-label="อุปกรณ์">${deviceMarkup(response)}</td>
                  <td data-label="วันและเวลา" class="response-date">${escapeHtml(
                    dateFormatter.format(new Date(response.createdAt))
                  )}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function deviceMarkup(response) {
  if (!response.deviceId && !response.networkId) {
    return '<span class="muted">ข้อมูลเดิม</span>';
  }
  return `
    <span class="response-device">
      <strong>เครื่อง #${escapeHtml(response.deviceId || "ไม่ทราบ")}</strong>
      <small>เครือข่าย #${escapeHtml(response.networkId || "ไม่ทราบ")}</small>
    </span>
  `;
}

function emptyState() {
  return `
    <div class="responses-empty">
      <strong>ยังไม่มีคำตอบ</strong>
      <span>คำตอบใหม่จะแสดงในหน้านี้ทันทีเมื่อมีผู้ส่งแบบประเมิน</span>
    </div>
  `;
}
