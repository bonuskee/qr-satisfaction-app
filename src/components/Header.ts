export function Header(container, actions) {
  container.innerHTML = `
    <header class="header">
      <div class="header__title">
        <div class="header__icon" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <h1>แดชบอร์ดความพึงพอใจ</h1>
          <p>ระบบสำรวจความพึงพอใจผ่าน QR Code</p>
        </div>
      </div>
      <div class="header__actions">
        <button class="button button--primary" data-create><span>+</span> สร้างแบบสำรวจ</button>
        <button class="button" data-logout>ออกจากระบบ</button>
      </div>
    </header>
  `;

  container.querySelector("[data-create]").addEventListener("click", actions.onCreate);
  container.querySelector("[data-logout]").addEventListener("click", actions.onLogout);
}
