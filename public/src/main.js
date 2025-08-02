document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.btn-tab');
  const content = document.getElementById('content');

  tabs.forEach(btn => {
    btn.classList.add('text-left', 'px-3', 'py-2', 'rounded', 'hover:bg-gray-100');
    btn.addEventListener('click', async () => renderTab(btn.dataset.tab));
  });

  async function renderTab(tab) {
    content.innerHTML = `<h1 class="text-xl font-bold mb-4">Загрузка...</h1>`;
    let html = '';

    switch(tab) {
      case 'balance':
        html = `
          <h1 class="text-xl font-bold mb-4">Баланс симкарты</h1>
          <input id="phone" class="input mb-2" placeholder="Введите номер (+7...)" />
          <button class="btn" onclick="getBalance()">Получить</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'code':
        html = `
          <h1 class="text-xl font-bold mb-4">Код (2FA)</h1>
          <input id="phone" class="input mb-2" placeholder="Номер симкарты" />
          <button class="btn" onclick="getCode()">Получить код</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'sms':
        html = `
          <h1 class="text-xl font-bold mb-4">Последнее SMS</h1>
          <input id="phone" class="input mb-2" placeholder="Номер симкарты" />
          <button class="btn" onclick="getSMS()">Получить SMS</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'history':
        html = `
          <h1 class="text-xl font-bold mb-4">История подключений</h1>
          <input id="phone" class="input mb-2" placeholder="Номер симкарты" />
          <button class="btn" onclick="getHistory()">Получить историю</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'send':
        html = `
          <h1 class="text-xl font-bold mb-4">Отправить SMS</h1>
          <input id="from" class="input mb-2" placeholder="Сим (опционально)" />
          <input id="to" class="input mb-2" placeholder="Кому" />
          <textarea id="text" class="input mb-2" placeholder="Текст"></textarea>
          <button class="btn" onclick="sendSMS()">Отправить</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'delete':
        html = `
          <h1 class="text-xl font-bold mb-4">Удалить все SMS</h1>
          <button class="btn" onclick="deleteMessages()">Удалить</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'refreshAll':
        html = `
          <h1 class="text-xl font-bold mb-4">Перезагрузить все модемы</h1>
          <button class="btn" onclick="refreshAll()">Перезагрузить</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'refresh':
        html = `
          <h1 class="text-xl font-bold mb-4">Перезагрузить выборочно</h1>
          <textarea id="phones" class="input mb-2" placeholder="Массив номеров в JSON"></textarea>
          <button class="btn" onclick="refreshModems()">Перезагрузить</button>
          <pre id="result" class="mt-4 text-sm whitespace-pre-wrap"></pre>
        `;
        break;
      case 'allbalances':
        const res = await fetch('/gsm/api/debug/allbalances');
        const data = await res.json();
        html = `
          <h1 class="text-xl font-bold mb-4">Балансы всех</h1>
          <pre class="mt-2 text-sm whitespace-pre-wrap bg-white p-3 rounded shadow">${JSON.stringify(data, null,2)}</pre>
        `;
        break;
    }

    content.innerHTML = html;
  }

  // API functions
  window.getBalance = async () => requestAndShow('/gsm/api/debug/balance', 'from');
  window.getCode    = async () => requestAndShow('/gsm/api/whale/code', 'from');
  window.getSMS     = async () => requestAndShow('/gsm/api/debug/sms', 'from');
  window.getHistory = async () => requestAndShow('/gsm/api/debug/history', 'from');
  window.deleteMessages = async () => simpleRequest('/gsm/api/debug/deletemessages');
  window.refreshAll    = async () => simpleRequest('/gsm/api/debug/refreshallmodems', 'POST');
  window.sendSMS       = async () => postWithBody('/gsm/api/2fa/send', {
    to: document.getElementById('to').value,
    text: document.getElementById('text').value
  }, document.getElementById('from').value);
  window.refreshModems = async () => postWithBody('/gsm/api/debug/refreshmodems', JSON.parse(document.getElementById('phones').value));

  async function requestAndShow(url, queryKey) {
    const param = document.getElementById('phone').value;
    const res = await fetch(`${url}?${queryKey}=${encodeURIComponent(param)}`);
    const data = await res.json();
    document.getElementById('result').textContent = JSON.stringify(data, null,2);
  }

  async function simpleRequest(url, method='GET') {
    const res = await fetch(url, { method });
    const data = await res.json();
    document.getElementById('result').textContent = JSON.stringify(data, null,2);
  }

  async function postWithBody(url, body, from) {
    const query = from ? `?from=${encodeURIComponent(from)}` : '';
    const res = await fetch(url+query, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    document.getElementById('result').textContent = JSON.stringify(data, null,2);
  }
});
