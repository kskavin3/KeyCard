import { adaToLovelace, formatAda } from './money.js';

const dashboard = document.querySelector('#dashboard');
const toast = document.querySelector('#toast');

function announce(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { toast.hidden = true; }, 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function showDashboard() {
  dashboard.hidden = false;
  loadListings();
  loadPayments();
}

async function loadListings() {
  const target = document.querySelector('#listing-list');
  target.innerHTML = '<p class="muted">Loading listings…</p>';
  try {
    const { items } = await api('/api/provider/listings');
    if (!items.length) {
      target.innerHTML = '<p class="muted">No listings yet. Register your first API above.</p>';
      return;
    }
    target.replaceChildren(...items.map(renderListing));
  } catch (error) {
    target.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

function renderListing(item) {
  const card = document.createElement('article');
  card.className = 'listing-card';
  const operationNames = item.operations.map(operation => {
    return `${operation.method} ${operation.operationId} · ${formatAda(operation.pricing.effectivePriceLovelace)}`;
  }).join(' · ');
  card.innerHTML = `<div class="listing-summary"><div><h3>${escapeHtml(item.name)}</h3><p class="muted small">${escapeHtml(item.listingId)} · ${escapeHtml(item.upstreamBaseUrl)}</p><p>${escapeHtml(item.description)}</p><p class="muted small">${escapeHtml(operationNames)}</p></div><span class="badge ${item.availability === 'available' ? 'active' : ''}">${escapeHtml(item.availability)}</span></div><div class="listing-actions"><label class="compact">Availability<select data-availability><option value="available">Available</option><option value="temporarily-unavailable">Temporarily unavailable</option><option value="disabled">Disabled</option></select></label><button class="button quiet" data-rotate>Rotate key</button></div><form class="rotate-form stack" hidden><div class="three-up"><label>Location<select name="mode"><option value="header">HTTP header</option><option value="query">Query parameter</option></select></label><label>Header / parameter<input name="field" value="${escapeHtml(item.authField)}" required /></label><label>New API key<input name="value" type="password" required minlength="4" /></label></div><button class="button" type="submit">Save new key</button></form>`;
  const availability = card.querySelector('[data-availability]');
  availability.value = item.availability;
  availability.addEventListener('change', async () => {
    try {
      await api(`/api/provider/listings/${encodeURIComponent(item.listingId)}/availability`, { method: 'PATCH', body: JSON.stringify({ availability: availability.value }) });
      announce('Listing availability updated.');
      card.querySelector('.badge').textContent = availability.value;
      card.querySelector('.badge').classList.toggle('active', availability.value === 'available');
    } catch (error) { announce(error.message, true); availability.value = item.availability; }
  });
  const rotateForm = card.querySelector('.rotate-form');
  card.querySelector('[data-rotate]').addEventListener('click', () => { rotateForm.hidden = !rotateForm.hidden; });
  rotateForm.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(rotateForm);
    try {
      await api(`/api/provider/listings/${encodeURIComponent(item.listingId)}/credential`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(values)) });
      rotateForm.reset();
      rotateForm.hidden = true;
      announce('Upstream key rotated.');
    } catch (error) { announce(error.message, true); }
  });
  return card;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

document.querySelector('#refresh-listings').addEventListener('click', loadListings);

document.querySelector('#listing-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    const inputSchema = JSON.parse(values.inputSchema);
    const outputSchema = JSON.parse(values.outputSchema);
    const priceLovelace = adaToLovelace(values.cost);
    const payload = {
      listing: {
        ...(values.listingId ? { listingId: values.listingId } : {}),
        name: values.name,
        description: values.description,
        capabilities: values.capabilities.split(',').map(value => value.trim()).filter(Boolean),
      },
      upstream: { baseUrl: values.baseUrl, requestTimeoutMs: 5000 },
      credential: { mode: values.authMode, field: values.authField, value: values.secret },
      operations: [{ operationId: values.operationId, name: values.operationName, description: values.operationDescription, method: values.method, path: values.path, inputSchema, outputSchema, priceLovelace, markupBasisPoints: 200, enabled: true }],
      payoutAddress: values.payoutAddress,
    };
    const result = await api('/api/provider/listings', { method: 'POST', body: JSON.stringify(payload) });
    document.querySelector('#preview-form [name="listingId"]').value = result.listingId;
    document.querySelector('#preview-form [name="operationId"]').value = result.operationIds[0];
    form.reset();
    announce(`Listing ${result.listingId} saved.`);
    loadListings();
  } catch (error) { announce(error.message, true); }
});

document.querySelector('#preview-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const output = document.querySelector('#preview-result');
  output.hidden = false;
  output.textContent = 'Sending preview…';
  try {
    const result = await api(`/api/provider/preview/${encodeURIComponent(values.listingId)}/${encodeURIComponent(values.operationId)}`, { method: 'POST', body: values.input });
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) { output.textContent = error.message; }
});

showDashboard();

async function loadPayments() {
  const summary=document.querySelector('#earnings-summary');
  const list=document.querySelector('#payment-list');
  try {
    const [earnings,payments]=await Promise.all([api('/api/provider/earnings'),api('/api/provider/payments')]);
    summary.textContent=`Earned ${formatAda(earnings.earned_lovelace)} · Received ${formatAda(earnings.received_lovelace)} · Refunds due ${formatAda(earnings.refund_due_lovelace)} · Refunded ${formatAda(earnings.refunded_lovelace)} · ${earnings.pending_calls} pending · ${earnings.review_calls} need review`;
    list.replaceChildren(...payments.items.map(payment=>{
      const card=document.createElement('article');card.className='listing-card';
      const title=document.createElement('strong');title.textContent=`${payment.listingId} / ${payment.operationId}`;
      const detail=document.createElement('p');detail.className='muted small';
      detail.textContent=`${formatAda(payment.amountLovelace)} · ${payment.state} · payout ${payment.payoutStatus} · refund ${payment.refundStatus}`;
      card.append(title,detail);
      if(payment.transaction) {
        const link=document.createElement('a');link.href=`https://preprod.cardanoscan.io/transaction/${encodeURIComponent(payment.transaction)}`;
        link.textContent=payment.transaction;link.className='muted small';link.target='_blank';link.rel='noopener';card.append(link);
      }
      if(!payment.paymentConfirmed && ['settling','failed','review','executing'].includes(payment.state)) {
        const button=document.createElement('button');button.className='button quiet';button.textContent='Check confirmation';
        button.addEventListener('click',async()=>{try{await api(`/api/provider/payments/${payment.receiptId}/reconcile`,{method:'POST'});await loadPayments();}catch(error){announce(error.message,true);}});card.append(button);
      }
      if(payment.refundStatus==='due') {
        const form=document.createElement('form');form.className='stack';
        const input=document.createElement('input');input.placeholder='Confirmed Preprod refund transaction hash';input.required=true;input.pattern='[a-f0-9]{64}';
        const button=document.createElement('button');button.className='button';button.textContent='Record refund';
        form.append(input,button);form.addEventListener('submit',async event=>{event.preventDefault();try{
          await api(`/api/provider/payments/${payment.receiptId}/refund`,{method:'POST',body:JSON.stringify({transaction:input.value})});
          await loadPayments();announce('Confirmed refund recorded.');
        }catch(error){announce(error.message,true);}});card.append(form);
      }
      return card;
    }));
    if(!payments.items.length) list.textContent='No paid calls yet.';
  }catch(error){summary.textContent=error.message;}
}
document.querySelector('#refresh-payments').addEventListener('click',loadPayments);
