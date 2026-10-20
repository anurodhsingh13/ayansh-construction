'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const create = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};
const safeImage = (url, alt, className = '') => {
  const image = create('img', className);
  image.src = url;
  image.alt = alt;
  image.loading = 'lazy';
  image.onerror = () => image.remove();
  return image;
};

function serviceCard(service, index) {
  const card = create('article', 'service-card');
  const imageWrap = create('div', 'service-image-wrap');
  if (service.image_url) imageWrap.append(safeImage(service.image_url, service.title));
  const number = create('span', 'service-number', String(index + 1).padStart(2, '0'));
  imageWrap.append(number);
  const content = create('div', 'service-card-copy');
  content.append(create('h3', '', service.title), create('p', '', service.description));
  card.append(imageWrap, content);
  return card;
}

function projectCard(project, featured = false) {
  const card = create('article', featured ? 'featured-card' : 'project-card');
  if (project.image_url) card.append(safeImage(project.image_url, `${project.title} — ${project.location}`, 'project-image'));
  else card.append(create('div', 'project-image project-image-fallback', 'A project built with care'));
  const info = create('div', featured ? 'featured-info' : 'project-info');
  const meta = create('p', 'project-meta', `${project.category} · ${project.location}`);
  info.append(meta, create('h3', '', project.title), create('p', 'project-description', project.description));
  card.append(info);
  return card;
}

function displaySite(site) {
  const { settings, services, projects, featuredProject } = site;
  document.querySelectorAll('[data-business]').forEach((node) => { node.textContent = settings.business_name; });
  document.querySelectorAll('[data-owner]').forEach((node) => { node.textContent = settings.owner; });
  document.querySelectorAll('[data-location]').forEach((node) => { node.textContent = settings.location; });
  $('#about-text').textContent = settings.about_text;
  $('#contact-phone').textContent = settings.phone;
  $('#contact-phone').href = `tel:${settings.phone.replace(/[^\d+]/g, '')}`;
  $('#contact-location').textContent = settings.location;
  if (settings.email) {
    const emailLink = $('#contact-email');
    emailLink.textContent = settings.email;
    emailLink.href = `mailto:${settings.email}`;
    $('#contact-email-wrap').hidden = false;
  }
  const serviceGrid = $('#service-grid');
  serviceGrid.replaceChildren(...services.map(serviceCard));
  const featured = $('#featured-project');
  featured.replaceChildren();
  if (featuredProject) featured.append(projectCard(featuredProject, true));
  else {
    const fallback = create('div', 'featured-fallback');
    fallback.append(create('span', 'fallback-mark', 'A.'), create('div', '', ''));
    const text = create('div', 'fallback-copy');
    text.append(create('p', 'eyebrow', 'A place for what comes next'), create('h3', '', 'Every project starts with a conversation.'), create('a', 'text-link', 'Tell us about yours ↗'));
    text.lastChild.href = '#contact';
    fallback.append(text);
    featured.append(fallback);
  }
  const projectGrid = $('#project-grid');
  const otherProjects = projects.filter((project) => !featuredProject || project.id !== featuredProject.id);
  projectGrid.replaceChildren(...otherProjects.map((project) => projectCard(project)));
  $('#projects-empty').hidden = projects.length > 0;
}

async function loadSite() {
  try {
    const response = await fetch('/api/site');
    if (!response.ok) throw new Error('Site information could not be loaded.');
    displaySite(await response.json());
  } catch (error) {
    const message = create('p', 'site-load-error', 'Some site details could not be loaded. Please refresh the page or contact us by phone.');
    $('#service-grid').replaceChildren(message);
  }
}

const menuButton = $('.menu-toggle');
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  $('#site-nav').classList.toggle('is-open', !expanded);
});
$('#site-nav').addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    menuButton.setAttribute('aria-expanded', 'false');
    $('#site-nav').classList.remove('is-open');
  }
});

$('#year').textContent = String(new Date().getFullYear());
$('#enquiry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $('#form-message');
  const button = form.querySelector('button[type="submit"]');
  message.textContent = '';
  message.classList.remove('is-error');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your enquiry could not be sent.');
    form.reset();
    message.textContent = result.message;
  } catch (error) {
    message.textContent = error.message || 'Your enquiry could not be sent. Please call us instead.';
    message.classList.add('is-error');
  } finally {
    button.disabled = false;
  }
});

loadSite();
