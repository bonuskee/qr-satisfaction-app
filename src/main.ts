import { getDashboard, getSession, getSurvey, getSurveyResponses, logout } from "./api.ts";
import { Header } from "./components/Header.ts";
import { Login } from "./components/Login.ts";
import { QRModal } from "./components/QRModal.ts";
import { ResponseList } from "./components/ResponseList.ts";
import { StatsCards } from "./components/StatsCards.ts";
import { SummaryCharts } from "./components/SummaryCharts.ts";
import { SurveyCard } from "./components/SurveyCard.ts";
import { SurveyForm } from "./components/SurveyForm.ts";

const app = document.querySelector("#app");
let dashboard = null;

function setLoading() {
  app.innerHTML = `<section class="app-shell"><div class="state-message">กำลังโหลดข้อมูล...</div></section>`;
}

function showStateMessage(message) {
  app.innerHTML = `<section class="app-shell"><div class="state-message" data-message></div></section>`;
  app.querySelector("[data-message]").textContent = message;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function navigate(path, replace = false) {
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  renderRoute();
}

async function loadDashboard() {
  setLoading();
  dashboard = await getDashboard();
  renderDashboard();
}

function renderDashboard() {
  app.innerHTML = `
    <section class="app-shell">
      <div data-header></div>
      <div data-stats></div>
      <div data-summary-charts></div>
      <section class="survey-list" data-surveys></section>
    </section>
  `;

  Header(app.querySelector("[data-header]"), {
    onCreate: () => navigate("/surveys/new"),
    onLogout: async () => {
      try {
        await logout();
      } finally {
        dashboard = null;
        navigate("/login", true);
      }
    }
  });
  StatsCards(app.querySelector("[data-stats]"), dashboard.stats);
  SummaryCharts(app.querySelector("[data-summary-charts]"), dashboard.surveys);

  const list = app.querySelector("[data-surveys]");
  dashboard.surveys.forEach((survey) => {
    SurveyCard(list, survey, {
      onResponses: () => navigate(`/surveys/${encodeURIComponent(survey.id)}/responses`),
      onQr: () => QRModal(survey),
      onEdit: () => navigate(`/surveys/${encodeURIComponent(survey.id)}/edit`),
      onUpdated: async () => {
        dashboard = await getDashboard();
        renderDashboardAtSameScroll();
      },
      onDeleted: (updatedDashboard) => {
        dashboard = updatedDashboard;
        showToast("ลบแบบฟอร์มแล้ว");
        renderDashboardAtSameScroll();
      }
    });
  });
}

function renderDashboardAtSameScroll() {
  const top = window.scrollY;
  renderDashboard();
  window.scrollTo({ top, left: 0, behavior: "auto" });
}

function renderCreateForm() {
  app.innerHTML = `
    <section class="app-shell form-page">
      <button class="back-button" data-back>กลับแดชบอร์ด</button>
      <div data-form></div>
    </section>
  `;
  app.querySelector("[data-back]").addEventListener("click", () => navigate("/"));
  SurveyForm(app.querySelector("[data-form]"), {
    onSaved: () => {
      showToast("สร้างแบบสำรวจเรียบร้อย");
      navigate("/");
    }
  });
}

async function renderEditForm(surveyId) {
  setLoading();
  const survey = await getSurvey(surveyId);
  app.innerHTML = `
    <section class="app-shell form-page">
      <button class="back-button" data-back>กลับแดชบอร์ด</button>
      <div data-form></div>
    </section>
  `;
  app.querySelector("[data-back]").addEventListener("click", () => navigate("/"));
  SurveyForm(app.querySelector("[data-form]"), {
    survey,
    editMode: true,
    onSaved: () => {
      showToast("แก้ไขแบบสำรวจเรียบร้อย");
      navigate("/");
    }
  });
}

async function renderResponses(surveyId) {
  setLoading();
  const data = await getSurveyResponses(surveyId);
  app.innerHTML = `<section class="app-shell" data-responses></section>`;
  ResponseList(app.querySelector("[data-responses]"), data, {
    onBack: () => navigate("/")
  });
}

function renderLogin() {
  Login(app, {
    onLoggedIn: () => navigate("/", true)
  });
}

async function renderRespondPage(surveyId) {
  setLoading();
  try {
    const survey = await getSurvey(surveyId);
    app.innerHTML = `
      <section class="respond-shell">
        <div class="respond-panel" data-form></div>
      </section>
    `;
    SurveyForm(app.querySelector("[data-form]"), {
      survey,
      responseMode: true,
      onSaved: () => {
        app.innerHTML = `
          <section class="respond-shell">
            <div class="thank-you">
              <strong>ขอบคุณสำหรับคำตอบ</strong>
              <span>ระบบบันทึกคะแนนของคุณเรียบร้อยแล้ว</span>
            </div>
          </section>
        `;
      }
    });
  } catch (error) {
    showStateMessage(error.message);
  }
}

async function renderRoute() {
  const respondMatch = location.pathname.match(/^\/respond\/([^/]+)$/);
  if (respondMatch) {
    await renderRespondPage(decodeURIComponent(respondMatch[1]));
    return;
  }

  try {
    setLoading();
    const session = await getSession();
    if (!session.authenticated) {
      if (location.pathname !== "/login") history.replaceState({}, "", "/login");
      renderLogin();
      return;
    }

    if (location.pathname === "/login") history.replaceState({}, "", "/");
    if (location.pathname === "/") {
      await loadDashboard();
      return;
    }
    if (location.pathname === "/surveys/new") {
      renderCreateForm();
      return;
    }

    const editMatch = location.pathname.match(/^\/surveys\/([^/]+)\/edit$/);
    if (editMatch) {
      await renderEditForm(decodeURIComponent(editMatch[1]));
      return;
    }

    const responsesMatch = location.pathname.match(/^\/surveys\/([^/]+)\/responses$/);
    if (responsesMatch) {
      await renderResponses(decodeURIComponent(responsesMatch[1]));
      return;
    }

    navigate("/", true);
  } catch (error) {
    if (error.status === 401) {
      navigate("/login", true);
      return;
    }
    showStateMessage(error.message);
  }
}

window.addEventListener("popstate", renderRoute);
renderRoute();
