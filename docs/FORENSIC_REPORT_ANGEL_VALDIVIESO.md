# FORENSIC INVESTIGATION REPORT
## CSAM / Non-Consensual Deepfake Generation & Identity Fraud
### Classification: CONFIDENTIAL — For Law Enforcement Use

---

**Report Date:** 2026-04-07  
**Prepared by:** Platform Security / Admin  
**Report Reference:** INC-2026-04-07-CSAM-001  
**Status:** Evidence Package — Active Investigation

---

## 1. SUBJECT IDENTIFICATION

| Field | Value |
|-------|-------|
| **Full Name** | Angel Jesus Valdivieso Dominguez |
| **Primary Email** | thebackyartv@gmail.com |
| **Secondary Email** | anjosyagua@gmail.com |
| **Country** | Spain (ES) |
| **Primary IP Address** | 79.117.226.221 |
| **Instagram (main)** | @dientedeanjo |
| **Instagram (art)** | @vaaldangel |
| **Behance** | www.behance.net/dientedeanjo |
| **Field** | Art Studio — Diseño Gráfico, Ilustración, Diseño de Personajes, Animación |

### 1.1 Identity Confirmation

The subject's identity was confirmed by **direct victim testimony**:

- **Victim Angela Perez García** (@bluwet, TikTok) confirmed that model `ang` in the platform database is her photograph, taken from her TikTok account without consent. She confirmed that `thebackyartv@gmail.com` was visible as a **contact email on the subject's Instagram work profile** (@dientedeanjo), directly linking the platform account to Angel Jesus Valdivieso Dominguez.

- **Victim Natalia López Martín** confirmed she is model `n` in the database.

### 1.2 Relationship Map

```
Angel Jesus Valdivieso Dominguez
  │
  ├── Angela Perez García (@bluwet) — EX-GIRLFRIEND (relationship ~2019)
  │     └── Model: "ang" (saved 2026-04-06)
  │     └── Source: TikTok screenshot @bluwet
  │
  ├── Natalia López Martín — FRIEND / CLASSMATE until 2024
  │     └── Model: "n" (saved 2026-03-26)
  │
  ├── Unknown (model: "el") — 2026-03-26
  ├── Unknown (model: "and") — 2026-03-26
  ├── Unknown (model: "s") — 2026-03-26
  ├── Unknown (model: "m") — 2026-03-26
  ├── Unknown (model: "reb") — 2026-03-26 (WhatsApp photo source confirmed)
  ├── Unknown (model: "dos") — 2026-03-26
  ├── Unknown (model: "R") — 2026-03-27
  ├── Unknown (model: "ro") — 2026-03-28
  ├── Unknown (model: "ma") — 2026-04-06
  ├── Unknown (model: "mang") — 2026-04-06
  ├── Unknown (model: "doss") — 2026-04-06
  ├── Unknown (model: "lau") — 2026-04-06
  ├── Unknown (model: "cram") — 2026-04-06
  ├── Unknown (model: "noe") — 2026-04-06
  └── Unknown (model: "bl") — 2026-04-07
```

All victims are believed to be **current or former classmates from EASD José Val del Omar (Escuela de Arte Superior de Diseño), Granada, Spain**.

---

## 2. PLATFORM ACCOUNTS

### 2.1 Primary Account — `thebackyartv@gmail.com`

| Field | Value |
|-------|-------|
| Platform User ID | 957b162d-c7d8-47ac-93b7-783ec3468ca2 |
| Email | thebackyartv@gmail.com |
| Display Name | tehas |
| Auth Provider | email |
| Google ID (linked) | QixiNAiEj3TSnqP8ed0qACELe3C3 |
| Account Created | 2026-03-26T08:24:19.646Z |
| Last Activity | 2026-04-07T11:21:50.541Z |
| Region | ES (Spain) |
| Role | user |
| Subscription Status | trial |
| Total Models Created | 17 |
| Total Generations | 333 |
| Total Credit Transactions | 515 |
| Child Safety Incidents | **24 (all on 2026-04-07)** |

### 2.2 Secondary Account — `anjosyagua@gmail.com`

| Field | Value |
|-------|-------|
| Platform User ID | 6bda7a5a-d492-4801-b857-72f9bd38cc90 |
| Email | anjosyagua@gmail.com |
| Display Name | aa |
| Auth Provider | google |
| Google ID | fLjM7rEePzOaURTUoYkJceMUSXg2 |
| Account Created | 2026-03-12T08:51:13.686Z |
| Last Activity | 2026-03-18T11:16:01.166Z |
| Region | ES (Spain) |
| Role | **banned** |
| Total Models Created | 0 |
| Total Generations | **1,094** |
| Total Credit Transactions | **1,508** |
| Child Safety Incidents | 0 (CSAM content was generated but not caught — system updated post this account) |

### 2.3 Account Correlation

Both accounts operated from **Spain (ES)**, used the same workflow:
- `/api/generate/advanced` for NSFW image generation using real victim photos as references
- `/api/generations/batch-delete` to systematically destroy evidence after generation
- `/api/models` for creating and eventually deleting victim identity models

The secondary account was **banned** after platform review. The primary account escalated to CSAM-adjacent generation on 2026-04-07, triggering 24 automated safety blocks.

**Pattern comparison:**

| Metric | Account 1 (primary) | Account 2 (secondary) |
|--------|--------------------|-----------------------|
| Region | ES | ES |
| Bulk delete events | 36 | **142** |
| generate/advanced calls | 510 | 1,493 |
| Models then deleted | Yes (2026-04-07) | Yes (2026-03-18) |
| Account wipe attempt | Yes | Yes |
| Banned | No (yet) | **Yes** |

---

## 3. VICTIMS — CONFIRMED & IDENTIFIED

### 3.1 Victim 1 — Angela Perez García

| Field | Value |
|-------|-------|
| Full Name | Angela Perez García |
| TikTok | @bluwet |
| Platform Model Name | `ang` |
| Platform Model ID | 9249fcf3-097d-4b76-8b0a-ac7517fcb337 |
| Model Created | 2026-04-06T19:16:34.132Z |
| Relationship to Subject | Ex-girlfriend (~2019) |
| How Identified | Victim self-identified after being contacted; confirmed photo source was her TikTok |
| Evidence Provided by Victim | Instagram screenshot showing `thebackyartv@gmail.com` as contact email on subject's work profile |
| Photo 1 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510169975-61f0fdb8-d134-44ef-b906-797eda1c7b87-AayuoiuP0FToecE45nej2QsLLkf8oe.png) |
| Photo 2 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510887827-adsad-vjP1T9kliYoZwrgPbhhDahBm4mJbW7.png) |
| Photo 3 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510201847-Gemini_Generated_Image_g2q3lkg2q3lkg2q3-uySKDRexcpeDEYIuLPNXnuECIkn6hd.png) |

### 3.2 Victim 2 — Natalia López Martín

| Field | Value |
|-------|-------|
| Full Name | Natalia López Martín |
| Platform Model Name | `n` |
| Platform Model ID | 4affbf50-f8ee-494d-94de-0d3e1356ab6e |
| Model Created | 2026-03-26T08:59:25.143Z |
| Relationship to Subject | Friend / Classmate until 2024 |
| How Identified | Confirmed by Angela Perez García |
| Photo 1 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774519163054_a072af_609873045_1776316949695189_911038256579009799_n.jpg) |
| Photo 2 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774519160411_5nhc9c_IMG_0052.jpg) |
| Photo 3 | [link](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774519155416_j6m3xz_advanced-image_7c1a5507.jpg) |

### 3.3 Remaining Unidentified Victims (Account 1)

| Model ID | Name | Created | Photo 1 | Photo 2 | Photo 3 |
|----------|------|---------|---------|---------|---------|
| 97ac47f5 | el | 2026-03-26T08:26:01Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774517158076-5920293555328978314-Q0IQJ4Ff7l9PgsqFeKwDBOIMSv2wtE.jpg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774517151871-_MG_4654-XUauLCMS384xscyMq6NGEru9BmJ5gt.jpg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774517160923-_MG_4628-YBubFSh8o5FnjfSOiZFJyAWOv5x6XA.jpg) |
| 7348b696 | and | 2026-03-26T10:54:55Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526075883-advanced-image_d8f467d9__1_-zBXhx5DpsteImfgfzdaqDULZewDOca.jpg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526084376-Gemini_Generated_Image_nfcw0mnfcw0mnfcw-Ob8l9IqmdiUWWnXatWozaW0pokQF2W.png) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526090384-Gemini_Generated_Image_v8linmv8linmv8li-wGyoCakCI4IwwP8C9pWiUU369lpksH.png) |
| d62ee982 | s | 2026-03-26T11:06:33Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526578489-photo_5884257602894499322_y-meAcNwCHul1GhJIv99aQlpbt4PXOSI.jpg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526612245-Gemini_Generated_Image_pg6e2wpg6e2wpg6e-ITcrjtwc1AlhM8UTs3Q75o9PyxVK02.png) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526791272-610879130_33176417932003653_1541964995764302325_n_-_copia-KjD8RkptWHQym1pr3E6xS5Wb5gWmCd.jpg) |
| eea5a7ea | m | 2026-03-26T11:07:44Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526854199-Sin_t_tulo-tUen0s4EAkt8mQe5PG1EMXH6OCc1Se.png) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526859605-Gemini_Generated_Image_2b72ca2b72ca2b72_-_copia-DuWh0QdI5Tyiz4xMGzX07N7K3zJR0I.png) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774526862510-610879130_33176417932003653_1541964995764302325_n_-_copia__2_-WnVN4xDW0l0sxZ4syrDPNBWb7pzmRx.jpg) |
| 2c5e3d31 | reb | 2026-03-26T11:24:13Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774527838680-WhatsApp_Image_2026-03-09_at_09.52.12-MEVQVTUdpF6POk7fBPopx4TiJjvgr2.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774527842022-Gemini_Generated_Image_t3x9vzt3x9vzt3x9-iMG9EdGOsvaiXVhKja47Lv6gF331cM.png) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774527852025-Gemini_Generated_Image_wp7kezwp7kezwp7k-WLY1cjiXxKuvi7I1uYrhHWxmQxXpAL.png) |
| 066e5674 | dos | 2026-03-26T22:57:53Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774569446505-IMG_6333-wt1AUODguJnQi6RNSYo9b8PglyKDXv.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774569450759-IMG_6332-xi9bbBFJJBC5n3zguhhgNWo1BObhvv.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774569466128-IMG_6334-Cbx5WGjx79x9nugetOsBQJftvmO4iN.png) |
| 8b077109 | R | 2026-03-27T09:07:43Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774606051942-IMG_6343-TfEKJXLeupnCRhTAsRPU7CiSWl6U73.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774606055004-IMG_6349-sOcK4XAFKkk6kSixQVAekkqNo5Mmh5.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774606059897-IMG_6345-c7jks3NBdo67HzOUREuiQ9Wc5hxyzE.jpeg) |
| 21c96b14 | ro | 2026-03-28T08:53:35Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774691598025-IMG_6357-le1imWc1SUcmbpyHeq0KVSzmHrc93S.png) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774691606202-03_Cervilla_Marti_nez_Roci_o_-UhItcZGbCtBpXgEQI1KqqBmJInre8B.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1774691610312-IMG_6358-UNiiVqNcpPIBLd0LAKFKg8Bl7nHJKY.png) |
| 7bf540c9 | ma | 2026-04-06T10:49:11Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775479732265-87B9B5A5-D912-4F4F-B263-021C895D1CE6-zF9hYX99z8KV7KMT4xjw4HYHsXZNEo.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775479736178-IMG_6574-mO0bSArIzywV4DnmmRgzxR1LRXxFS9.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775479740379-IMG_6570-zwt1EKmOPNvXsiZBS5BNOX6POk0kw7.png) |
| 9b3910e8 | mang | 2026-04-06T11:08:04Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775480872951-13AA5FE6-67EC-457B-96A1-9DA07EC4E5DA-MUVdu5v4I8o1rk70spwXXBbkEAgtbC.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775480876569-71E39334-0E14-4D7A-A880-66D26677E08C-gd7zuDTbAW9GCqMsqCYfrQyXAbbQip.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775480881412-F195E6F5-36EE-4144-B86A-FCDCCE3B7208-HEU1EvBC9jnmaXfWZhbmgzkggytPj8.jpeg) |
| 43530ea3 | doss | 2026-04-06T13:46:53Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775490398432-EED5B6BB-93AF-46C3-889E-103161104E87-JTCzzG4VhjKCPVbt5z16c5677228DK.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775490405859-191D1DCF-B9B7-41ED-AF9E-3A0C47E5ACA3-B1Gj2Sx5LAXJb4xVXn4nrBpa2DiPEa.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775490410380-512BF6B6-A99F-45A9-906B-9C7D89DEA724-ukB4gCP7dszx2BIDJk0sq2pgHrnJ79.jpeg) |
| 4c9448ce | lau | 2026-04-06T14:38:43Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775493501477-IMG_6580-8zFcAgOIaIbTUDVpa9ZMQ9ktqwQbwG.jpeg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775493507426-IMG_6640-GAwLLbO7UKc4NbfJlvsOfakfY3JjDa.jpeg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775493517979-IMG_5290_Original-uAZTo6B1kDYk9X06Mosj91htoSoUzN.jpeg) |
| 9c711fa9 | cram | 2026-04-06T19:21:57Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510513932-dsa-uwzxP4QAKpf9mK1t6nysbG9JDmSaOi.png) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510516620-sadasd-o7wdim4wPyUxwnNlbS90HEcAOJqM1g.png) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775510524083-Gemini_Generated_Image_tpzy7etpzy7etpzy-hfrzrI8LwDEz4CcdJNIvnb8oVKODdb.png) |
| 0c159208 | noe | 2026-04-06T19:39:06Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775511536386-photo_5870526974701276602_w-LnN1HqQHSnulXowCc9SgCbY6Jp2Dkk.jpg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775511540843-5954259917642337810-kIgIovtmFfPcjdbqk0QA0t5ZWpjSwZ.jpg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775511554290-photo_5789817108916014614_y-OstCGOiJ0fdcqHZpLWPLJeVIhcXd5C.jpg) |
| d1ef7a7c | bl | 2026-04-07T11:01:35Z | [p1](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775566889486-5956242122358852952-JxKLGX45mnJlI71PrrVdBuRft5DUXP.jpg) | [p2](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775566892073-5956242122358852957-3VsZ6JNl7ShhKCTlulscmRyhf4gqFF.jpg) | [p3](https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/1775566895001-5956242122358852956-DOg0CeQuUbQnlnGaesZQXWFuCZncGr.jpg) |

> **Note:** Model file names include partial names (e.g. `ro` → `Rocío`, `lau` → `Laura`, `noe` → `Noel/Noelia`) consistent with Spanish female first name abbreviations. All are believed to be EASD Val del Omar students/alumni.

---

## 4. CHILD SAFETY INCIDENTS (CSAM)

All 24 incidents were generated on **2026-04-07** from a **single IP address: 79.117.226.221**.

The prompts escalated progressively from adult NSFW content to explicit CSAM-adjacent content stating the depicted person's age as **13 years old** (in Spanish: "tengo 13 años" / "tengo trece años").

### 4.1 Incident Timeline

| # | Timestamp (UTC) | Classifier Code | Prompt Preview |
|---|----------------|-----------------|----------------|
| 1 | 2026-04-07T11:07:41Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo 13 años'..." |
| 2 | 2026-04-07T11:07:52Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 3 | 2026-04-07T11:10:17Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 4 | 2026-04-07T11:10:22Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 5 | 2026-04-07T11:10:28Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 6 | 2026-04-07T11:10:33Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 7 | 2026-04-07T11:10:39Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 8 | 2026-04-07T11:10:45Z | safety_child_sexual_content | "...papel que pone 'Si, soy blanca y tengo trece años'..." |
| 9 | 2026-04-07T11:11:27Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 10 | 2026-04-07T11:13:14Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'... culo enorme" |
| 11 | 2026-04-07T11:13:21Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 12 | 2026-04-07T11:13:26Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 13 | 2026-04-07T11:15:48Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'... sonriendo" |
| 14 | 2026-04-07T11:15:54Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 15 | 2026-04-07T11:15:59Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 16 | 2026-04-07T11:17:26Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 17 | 2026-04-07T11:17:31Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 18 | 2026-04-07T11:17:36Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 19 | 2026-04-07T11:19:50Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 20 | 2026-04-07T11:20:03Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 21 | 2026-04-07T11:20:10Z | safety_child_sexual_content | "...papel que pone 'Soy Blanca y tengo 13'..." |
| 22 | 2026-04-07T11:20:20Z | safety_child_sexual_content | "...papel que pone 'Si, tengo 13'..." |
| 23 | 2026-04-07T11:20:30Z | safety_child_sexual_content | "...papel que pone 'Si, tengo trece'..." |
| 24 | 2026-04-07T11:21:50Z | (bypassed classifier) | adult NSFW content using same reference |

> **Note:** All incidents used a real photo of an identified or unidentified victim as the base reference image. The subject attempted to generate images depicting the real victim in CSAM scenarios.

### 4.2 Evidence-Destruction Behavior

After the CSAM blocks, the subject immediately attempted to:
1. Batch-delete all generation history (`POST /api/generations/batch-delete` — HTTP 500 blocked by platform lock)
2. Delete victim model `bl` (`DELETE /api/models/d1ef7a7c` — HTTP 500 blocked by platform lock)

Both attempts were **blocked** by the content-deletion lock implemented on the platform.

---

## 5. EVIDENCE OF IDENTITY — CHAIN OF PROOF

### 5.1 Direct Evidence (Highest Strength)

**Instagram contact email screenshot:**
- Victim Angela Perez García contacted the subject's Instagram profile @dientedeanjo
- The "Contactar" / "Email" button on the profile revealed the email: **`thebackyartv@gmail.com`**
- This directly and irrefutably links the platform account to Angel Jesus Valdivieso Dominguez

**Source screenshots:** Provided in attached images:
- `photo_4_2026-04-07_23-52-13` — shows @dientedeanjo profile with email button
- `photo_3_2026-04-07_23-52-13` — shows Contact modal with `thebackyartv@gmail.com` visible

### 5.2 Supporting Evidence

| # | Type | Evidence |
|---|------|---------|
| 1 | Instagram profile | @dientedeanjo business profile shows `thebackyartv@gmail.com` as contact email |
| 2 | Instagram account | @vaaldangel drawing account links to @dientedeanjo |
| 3 | Third Instagram | @angyizz personal account — bio says "alm gr @dientedeanjo @vaaldangel" (same person's personal account) |
| 4 | Platform DB | Account `thebackyartv@gmail.com` has linked Google ID `QixiNAiEj3TSnqP8ed0qACELe3C3` |
| 5 | Victim testimony | Angela Perez García confirmed model `ang` is her photo taken from @bluwet TikTok without consent |
| 6 | Victim testimony | Natalia López Martín confirmed model `n` is her photo |
| 7 | IP address | All CSAM incidents originated from `79.117.226.221` (Spain) |
| 8 | School connection | All victims confirmed to be from EASD José Val del Omar, Granada |
| 9 | Evidence destruction | Subject attempted to delete evidence immediately after CSAM blocks |
| 10 | Multi-account | Second account `anjosyagua@gmail.com` shows identical operational behavior from same region |

### 5.3 Instagram Account Network

```
Angel Jesus Valdivieso Dominguez
  │
  ├── @dientedeanjo (work / studio account)
  │     └── Contact email: thebackyartv@gmail.com ← DIRECT LINK
  │     └── Behance: www.behance.net/dientedeanjo
  │     └── Followers: 208
  │
  ├── @vaaldangel (drawing / illustration account)
  │     └── "Projects account > @dientedeanjo"
  │     └── Followers: 70
  │
  └── @angyizz (personal account)
        └── Bio: "alm gr @dientedeanjo @vaaldangel"
        └── Followers: 373
```

---

## 6. TIMELINE OF EVENTS

```
2026-03-12T08:51  Account 2 (anjosyagua@gmail.com) created — starts generating NSFW with victim photos
2026-03-12T09:14  Account 2 — first batch-delete of evidence
2026-03-14        Account 2 — CSAM-adjacent generation attempts (500 errors, system not yet equipped)
2026-03-18T11:15  Account 2 — mass deletion of all models (evidence destruction)
2026-03-18T11:16  Account 2 — final activity, account subsequently banned

2026-03-26T08:24  Account 1 (thebackyartv@gmail.com) created — 8 days later, new account
2026-03-26T08:26  Account 1 — first model created ("el")
2026-03-26T08:59  Account 1 — second model ("n" = Natalia López Martín)
2026-03-26T10:54  Account 1 — model "and"
2026-03-26T11:06  Account 1 — models "s", "m", "reb"
2026-03-26T22:57  Account 1 — model "dos"
2026-03-27T09:07  Account 1 — model "R"
2026-03-28T08:53  Account 1 — model "ro"

2026-04-06T10:49  Account 1 — resumes after 9 day gap, model "ma"
2026-04-06T11:08  Account 1 — model "mang"
2026-04-06T13:46  Account 1 — model "doss"
2026-04-06T14:38  Account 1 — model "lau"
2026-04-06T19:16  Account 1 — model "ang" (= Angela Perez García, ex-girlfriend)
2026-04-06T19:21  Account 1 — model "cram"
2026-04-06T19:39  Account 1 — model "noe"

2026-04-07T11:01  Account 1 — model "bl" (last model created, same day as CSAM incidents)
2026-04-07T11:07  Account 1 — FIRST CSAM INCIDENT BLOCKED (13 years old stated)
2026-04-07T11:07–11:21  Account 1 — 24 CSAM incidents blocked in rapid succession
2026-04-07T11:22  Account 1 — ATTEMPTS EVIDENCE DESTRUCTION (batch-delete + model delete) — BLOCKED
2026-04-07T11:25  Account 1 — last profile check, subject still active
```

---

## 7. LEGAL VIOLATIONS

The subject's conduct likely constitutes violations of:

**Spain:**
- Art. 189 Código Penal — Pornografía infantil (production/attempt to produce)
- Art. 197 Código Penal — Descubrimiento y revelación de secretos (unauthorized use of personal images)
- Art. 173 Código Penal — Trato degradante
- Ley Orgánica 1/1982 — Derecho al honor, intimidad personal y propia imagen

**European Union:**
- Directive 2011/93/EU — Combating the sexual abuse and sexual exploitation of children
- GDPR Art. 9 — Processing of special categories of personal data (biometric)

**International:**
- Optional Protocol to the Convention on the Rights of the Child on the sale of children, child prostitution and child pornography

---

## 8. RECOMMENDED ACTIONS

### Immediate (Platform)
- [x] Account content-deletion lock applied (cannot delete generations or models)
- [x] Identity update lock applied (cannot change name or email)
- [x] DB-level deletion triggers installed on `Generation`, `SavedModel`, `TrainedLora`
- [ ] **Permanent account ban** — pending
- [ ] **Preserve all generated content as evidence** — ensure no auto-cleanup runs

### Immediate (Legal)
1. **Report to Spanish police (Policía Nacional / Guardia Civil)** — Grupo de Delitos Telemáticos
   - https://www.gdt.guardiacivil.es/
   - Attach this report + screenshots

2. **Report to INCIBE (Instituto Nacional de Ciberseguridad)**
   - https://incibe.es/en/linea-ayuda-ciberseguridad
   - CSAM/identity fraud report

3. **Google Emergency Preservation Request**
   - Email: `thebackyartv@gmail.com`
   - Preserve: account creation, login IPs, recovery contacts, device data
   - Use: https://support.google.com/code/contact/le_emergency

4. **NCMEC CyberTipline** (US — handles CSAM globally)
   - https://www.missingkids.org/gethelpnow/cybertipline
   - Upload incident data

5. **Contact victims** — notify all identified and unidentified victims about evidence preservation

### Evidence Preservation
All victim photos stored in Vercel Blob at:
`https://yvltv36iioabqopc.public.blob.vercel-storage.com/user-uploads/`

Platform holds:
- 17 model records with photo URLs
- 333 generation records
- 24 CSAM incident records
- API request telemetry
- Edge event logs

---

## 9. EXHIBITS

| Exhibit | Description | Source |
|---------|-------------|--------|
| A | Instagram @dientedeanjo profile showing contact email `thebackyartv@gmail.com` | Provided by victim Angela Perez García |
| B | Instagram @vaaldangel drawing account linking to @dientedeanjo | Provided by victim |
| C | Instagram @angyizz personal account linking to @dientedeanjo and @vaaldangel | Provided by victim |
| D | TikTok @bluwet screenshot showing victim photo used as model `ang` | Platform database |
| E | Platform DB export — 17 victim models with photo URLs | Platform database |
| F | Platform DB export — 24 CSAM incident records with full prompts | Platform database |
| G | Graduation ceremony photo — EASD Val del Omar (school connection) | Provided by investigator |
| H | Platform DB export — 333 generation records | Platform database |
| I | AdminAuditLog — evidence-destruction attempt timestamps | Platform database |

---

## 10. CONTACT / REPORTING

**Reporting Platform:**  
[Your platform name]  
[Your email]  
[Your phone]

**Victim Support Contact:**  
Angela Perez García — Instagram @bluwet  
Natalia López Martín — confirmed via Angela

---

*This document is prepared as a factual forensic summary for law enforcement purposes. All data was extracted directly from platform databases under the operator's legitimate interest and legal obligation to report child sexual abuse material. Records are immutable and stored independently of any user account changes or deletions.*

---

**END OF REPORT**  
**INC-2026-04-07-CSAM-001**
