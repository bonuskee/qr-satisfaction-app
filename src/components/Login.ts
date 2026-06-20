import { login } from "../api.ts";

export function Login(container, actions) {
  container.innerHTML = `
    <section class="login-shell">
      <div class="login-panel">
        <div class="login-brand" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="login-heading">
          <p>สำหรับผู้ดูแลระบบ</p>
          <h1>เข้าสู่แดชบอร์ด</h1>
          <span>ระบบจัดการแบบสำรวจความพึงพอใจ</span>
        </div>
        <form class="login-form">
          <label>
            รหัสผ่าน
            <input type="password" name="password" autocomplete="current-password" maxlength="256" required autofocus />
          </label>
          <p class="form-error" data-error></p>
          <button class="button button--login" type="submit">เข้าสู่ระบบ</button>
        </form>
      </div>
    </section>
  `;

  const form = container.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    const error = form.querySelector("[data-error]");
    const password = new FormData(form).get("password");
    submit.disabled = true;
    error.textContent = "";

    try {
      await login(password);
      actions.onLoggedIn();
    } catch (requestError) {
      error.textContent = requestError.message;
      form.querySelector("input").select();
    } finally {
      submit.disabled = false;
    }
  });
}
