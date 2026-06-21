import { escapeHtml } from "../utils.ts";

const ratings = [
  { rating: 1, label: "ไม่พอใจ" },
  { rating: 2, label: "ควรปรับปรุง" },
  { rating: 3, label: "ปานกลาง" },
  { rating: 4, label: "ดี" },
  { rating: 5, label: "ดีมาก" }
];

function axisScale(surveys) {
  const highest = Math.max(0, ...surveys.flatMap((survey) => survey.distribution.map((item) => item.count)));
  let step = Math.max(1, Math.ceil(highest / 4));
  if (step >= 5) step = Math.ceil(step / 5) * 5;
  const maximum = step * 4;
  return {
    maximum,
    ticks: [maximum, maximum - step, maximum - step * 2, step, 0]
  };
}

function groupByBranch(surveys) {
  const groups = new Map();
  surveys.forEach((survey) => {
    const branch = survey.branch.trim() || "ไม่ระบุแผนก";
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch).push(survey);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "th"));
}

function chartMarkup(branch, surveys) {
  const scale = axisScale(surveys);
  const minimumWidth = Math.max(280, surveys.length * 145);

  return `
    <article class="summary-chart">
      <h3>${escapeHtml(branch)}</h3>
      <div class="summary-chart__body">
        <div class="summary-chart__axis" aria-hidden="true">
          ${scale.ticks.map((tick) => `<span>${tick}</span>`).join("")}
        </div>
        <div class="summary-chart__scroll" tabindex="0" aria-label="กราฟคะแนนของแผนก ${escapeHtml(branch)}">
          <div class="summary-chart__plot" style="--chart-min-width:${minimumWidth}px">
            <div class="summary-chart__grid" aria-hidden="true"></div>
            <div class="summary-chart__groups">
              ${surveys
                .map(
                  (survey) => `
                    <div class="summary-chart__group">
                      <div class="summary-chart__bars">
                        ${ratings
                          .map((rating) => {
                            const item = survey.distribution.find((entry) => entry.rating === rating.rating);
                            const count = item?.count || 0;
                            const percentage = (count / scale.maximum) * 100;
                            return `
                              <div
                                class="summary-chart__bar-wrap"
                                title="${escapeHtml(survey.title)}: ${rating.label} ${count} คำตอบ"
                                aria-label="${rating.label} ${count} คำตอบ"
                              >
                                <span>${count}</span>
                                <div
                                  class="summary-chart__bar summary-chart__bar--${rating.rating}${count === 0 ? " summary-chart__bar--empty" : ""}"
                                  style="--bar-height:${percentage}%"
                                ></div>
                              </div>
                            `;
                          })
                          .join("")}
                      </div>
                      <strong title="${escapeHtml(survey.title)}">${escapeHtml(survey.title)}</strong>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

export function SummaryCharts(container, surveys) {
  const groups = groupByBranch(surveys);
  container.innerHTML = `
    <section class="summary-charts">
      <div class="summary-charts__heading">
        <h2>สรุปคะแนนรายแผนก</h2>
        <div class="summary-charts__legend" aria-label="ระดับคะแนน">
          ${ratings
            .map(
              (item) => `
                <span><i class="summary-charts__swatch summary-charts__swatch--${item.rating}"></i>${item.rating} ${item.label}</span>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="summary-charts__list">
        ${groups.length ? groups.map(([branch, owned]) => chartMarkup(branch, owned)).join("") : '<p class="summary-charts__empty">ยังไม่มีแบบสำรวจ</p>'}
      </div>
    </section>
  `;
}
