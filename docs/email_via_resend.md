# Resend - Express

## Prerequisites

To get the most out of this guide, you’ll need to:

- Create an API key
- Verify your domain

---

## 1. Install

Get the Resend Node.js SDK:

```sh
npm install resend
```

---

## 2. Send Email Using HTML

The easiest way to send an email is by using the `html` parameter.

### server.ts

```typescript
import express, { Request, Response } from 'express'
import { Resend } from 'resend'

const app = express()
const resend = new Resend('re_123456789')

app.get('/', async (req: Request, res: Response) => {
  const { data, error } = await resend.emails.send({
    from: 'Acme <onboarding@resend.dev>',
    to: ['delivered@resend.dev'],
    subject: 'hello world',
    html: '<strong>it works!</strong>'
  })

  if (error) {
    return res.status(400).json({ error })
  }

  res.status(200).json({ data })
})

app.listen(3000, () => {
  console.log('Listening on http://localhost:3000')
})
```

---

## 3. Try It Yourself

### Express Example

See the full source code.

---

## More Resources

- [Nuxt](#)
- [RedwoodJS](#)
- [Twitter](#)
- [GitHub](#)
- [Discord](#)
- [Website](#)

---

## On This Page

- [Prerequisites](#prerequisites)
- [1. Install](#1-install)
- [2. Send Email Using HTML](#2-send-email-using-html)
- [3. Try It Yourself](#3-try-it-yourself)
