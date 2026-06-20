const cards = [
  { key: "surveys", label: "แบบสำรวจทั้งหมด", icon: "clipboard", color: "blue" },
  { key: "responses", label: "คำตอบทั้งหมด", icon: "chat", color: "green" },
  { key: "average", label: "คะแนนเฉลี่ยรวม", icon: "star", color: "gold" }
];

export function StatsCards(container, stats) {
  container.innerHTML = `
    <section class="stats-grid">
      ${cards
        .map((card) => {
          const value = card.key === "average" ? `${stats.average}/5` : stats[card.key];
          return `
            <article class="stat-card stat-card--${card.color}">
              <div class="stat-card__icon stat-card__icon--${card.icon}" aria-hidden="true"></div>
              <strong>${value}</strong>
              <span>${card.label}</span>
            </article>
          `;
        })
        .join("")}
    </section>
  `;
}
