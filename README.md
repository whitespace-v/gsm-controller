# Отправка сообщения без указания симки:

> [!tip] _Будет использована та которая которая давно не использовалась_

- **method**: _POST_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/2fa/send`
- **payload**: `{"to": "+79841894786", "text": "2735"}`

# Отправка сообщения с определённой симки:

> [!tip] номер телефона в формате `%2B79841894786`

- **method**: _POST_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/2fa/send?from=%2B<phone_number>`
- **payload**: `{"to": "+79841894786", "text": "2735"}`

# Получение баланса со всех симок:

- **method**: _GET_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/debug/allbalances`

# Получение баланса с определённой симки:

- **method**: _GET_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/debug/balance?from=%2B79140772433`

# Перезагрузка выбранных модемов (нуждается в доработке):

- **method**: _POST_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/debug/refreshmodems`
- **payload**: `{"phones": ["+79140772433","+79140774084"]}`

# Получение кода для авторизации в банках

- **method**: _GET_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/whale/code?from=%2B<phone_number>`

# Получение любого входящего сообщения

- **method**: _GET_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/debug/sms?from=%2B<phone_number>`

# Высасывание последних записанных логов:

- **method**: _GET_
- **path**: `http://gsm.whalepay.ru:7777/gsm/api/logs?numbers=<необходимое количество строк>`
