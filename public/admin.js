'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const create = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};
const state = { csrfToken: '', settings: {}, services: [], projects: [], enquiries: [] };
const statuses = ['New', 'In progress', 'Contacted', 'Closed'];

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  let result = {};
  try { result = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) {
    if (response.status === 401) showLogin(result.error || 'Please sign in to continue.');
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}

function showLogin(message = '') {
  $('#login-panel').hidden = false;
  $('#dashboard').hidden = true;
  $('#login-message').textContent = message;
}

function setMessage(message, isError = false) {
  const node = $('#dashboard-message');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

function fillForm(form, values) {
  for (const [key, value] of Object.entries(values)) {
    if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value ?? '';
  }
}

async function loadDashboard() {
  try {
    const data = await request('/api/admin/data');
    Object.assign(state, data);
    $('#login-panel').hidden = true;
    $('#dashboard').hidden = false;
    renderEnquiries();
    renderServices();
    renderProjects();
    fillForm($('#settings-form'), state.settings);
  } catch (error) {
    if (!$('#login-panel').hidden) {
      $('#login-message').textContent = error.message;
      return;
    }
    setMessage(error.message, true);
  }
}

function renderEnquiries() {
  const root = $('#enquiries-list');
  root.replaceChildren();
  if (!state.enquiries.length) {
    root.append(create('p', 'admin-empty', 'No enquiries yet. New messages from the website will appear here.'));
    return;
  }
  state.enquiries.forEach((item) => {
    const card = create('article', 'enquiry-card');
    const head = create('div', 'enquiry-head');
    const identity = create('div');
    identity.append(create('h3', '', item.name), create('p', 'enquiry-date', new Date(item.created_at).toLocaleString()));
    const actions = create('div', 'enquiry-actions');
    const status = document.createElement('select');
    status.setAttribute('aria-label', `Follow-up status for ${item.name}`);
    statuses.forEach((option) => {
      const element = create('option', '', option);
      element.value = option;
      element.selected = option === item.status;
      status.append(element);
    });
    status.addEventListener('change', () => mutate(`/api/admin/enquiries/${item.id}`, 'PATCH', { status: status.value }));
    const remove = create('button', 'text-button danger-button', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (window.confirm(`Delete the enquiry from ${item.name}? This cannot be undone.`)) {
        await mutate(`/api/admin/enquiries/${item.id}`, 'DELETE');
      }
    });
    actions.append(status, remove);
    head.append(identity, actions);
    const details = create('div', 'enquiry-details');
    const email = create('a', '', item.email);
    email.href = `mailto:${item.email}`;
    details.append(email);
    if (item.phone) {
      const phone = create('a', '', item.phone);
      phone.href = `tel:${item.phone.replace(/[^\d+]/g, '')}`;
      details.append(phone);
    }
    card.append(head, create('p', 'enquiry-project-type', item.project_type), create('p', 'enquiry-description', item.description), details);
    root.append(card);
  });
}

function resetEditor(form, details) {
  form.reset();
  form.elements.id.value = '';
  details.open = false;
  details.querySelector('summary').textContent = `Add a ${form.id === 'service-form' ? 'service' : 'project'}`;
}

function renderServices() {
  const root = $('#services-list');
  root.replaceChildren();
  if (!state.services.length) root.append(create('p', 'admin-empty', 'No services have been added yet.'));
  state.services.forEach((service, index) => {
    const row = create('article', 'content-row');
    const summary = create('div', 'content-row-copy');
    summary.append(create('h3', '', service.title), create('p', '', service.description));
    const actions = create('div', 'content-row-actions');
    const up = create('button', 'icon-button', '↑');
    up.type = 'button'; up.title = 'Move service up'; up.disabled = index === 0;
    up.addEventListener('click', () => reorderService(index, -1));
    const down = create('button', 'icon-button', '↓');
    down.type = 'button'; down.title = 'Move service down'; down.disabled = index === state.services.length - 1;
    down.addEventListener('click', () => reorderService(index, 1));
    const edit = create('button', 'text-button', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const details = $('#service-editor');
      fillForm($('#service-form'), service);
      details.open = true;
      details.querySelector('summary').textContent = 'Edit service';
      details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = create('button', 'text-button danger-button', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (window.confirm(`Delete “${service.title}”?`)) await mutate(`/api/admin/services/${service.id}`, 'DELETE');
    });
    actions.append(up, down, edit, remove);
    row.append(summary, actions);
    root.append(row);
  });
}

function renderProjects() {
  const root = $('#projects-list');
  root.replaceChildren();
  if (!state.projects.length) root.append(create('p', 'admin-empty', 'No projects yet. Add a project to share selected work on your public site.'));
  state.projects.forEach((project) => {
    const row = create('article', 'content-row');
    const summary = create('div', 'content-row-copy');
    const title = create('h3', '', project.title);
    if (project.featured) title.append(create('span', 'featured-badge', 'Featured'));
    summary.append(title, create('p', '', `${project.category} · ${project.location}`), create('p', 'project-description', project.description));
    const actions = create('div', 'content-row-actions');
    if (!project.featured) {
      const feature = create('button', 'text-button', 'Feature');
      feature.type = 'button';
      feature.addEventListener('click', () => mutate(`/api/admin/projects/${project.id}/featured`, 'POST', {}));
      actions.append(feature);
    }
    const edit = create('button', 'text-button', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const details = $('#project-editor');
      fillForm($('#project-form'), project);
      details.open = true;
      details.querySelector('summary').textContent = 'Edit project';
      details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = create('button', 'text-button danger-button', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (window.confirm(`Delete “${project.title}”?`)) await mutate(`/api/admin/projects/${project.id}`, 'DELETE');
    });
    actions.append(edit, remove);
    row.append(summary, actions);
    root.append(row);
  });
}

async function mutate(url, method, body) {
  setMessage('');
  try {
    const result = await request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    setMessage(result.message || 'Saved.');
    await loadDashboard();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function reorderService(index, direction) {
  const ids = state.services.map((service) => service.id);
  const target = index + direction;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await mutate('/api/admin/services/reorder', 'POST', { ids });
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  $('#login-message').textContent = 'Signing in…';
  try {
    const result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(formValues(form)) });
    state.csrfToken = result.csrfToken;
    form.reset();
    $('#login-message').textContent = 'Loading dashboard…';
    await loadDashboard();
  } catch (error) {
    $('#login-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', { method: 'POST', body: '{}' });
    state.csrfToken = '';
    showLogin('You have been signed out.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
    document.querySelectorAll('.admin-panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${button.dataset.tab}`; });
  });
});

$('#service-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  const id = values.id;
  delete values.id;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await request(id ? `/api/admin/services/${id}` : '/api/admin/services', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    resetEditor(form, $('#service-editor'));
    setMessage(id ? 'Service updated.' : 'Service added.');
    await loadDashboard();
  } catch (error) {
    setMessage(error.message, true);
  } finally { button.disabled = false; }
});
$('#service-form').addEventListener('reset', () => {
  setTimeout(() => { $('#service-editor').querySelector('summary').textContent = 'Add a service'; }, 0);
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  const id = values.id;
  delete values.id;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await request(id ? `/api/admin/projects/${id}` : '/api/admin/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
    resetEditor(form, $('#project-editor'));
    setMessage(id ? 'Project updated.' : 'Project added.');
    await loadDashboard();
  } catch (error) {
    setMessage(error.message, true);
  } finally { button.disabled = false; }
});
$('#project-form').addEventListener('reset', () => {
  setTimeout(() => { $('#project-editor').querySelector('summary').textContent = 'Add a project'; }, 0);
});

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await request('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(formValues(event.currentTarget)) });
    setMessage(result.message);
    await loadDashboard();
  } catch (error) {
    setMessage(error.message, true);
  } finally { button.disabled = false; }
});

request('/api/admin/data').then((data) => {
  Object.assign(state, data);
  $('#login-panel').hidden = true;
  $('#dashboard').hidden = false;
  renderEnquiries();
  renderServices();
  renderProjects();
  fillForm($('#settings-form'), state.settings);
}).catch((error) => showLogin(error.message === 'Please sign in to continue.' ? '' : error.message));
