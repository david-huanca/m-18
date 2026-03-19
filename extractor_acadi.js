/**
 * =====================================================
 *   ACADi Course Content Extractor
 *   Instrucciones:
 *   1. Ve a: https://www.acadi.net/manage/courses/3271381/
 *   2. Abre la consola del navegador: F12 → pestaña "Console"
 *   3. Pega TODO este código y presiona Enter
 *   4. Espera a que termine (verás el panel de progreso)
 *   5. Se descargará automáticamente un archivo JSON con todo
 * =====================================================
 */
(async function ACADiExtractor() {

  // ── CONFIGURACIÓN ──────────────────────────────────
  const COURSE_ID = window.location.pathname.match(/courses\/(\d+)/)?.[1] ?? '3271381';
  const BASE      = window.location.origin;          // https://www.acadi.net
  const DELAY_MS  = 900;                             // pausa entre peticiones (ms)

  // ── UI – panel flotante de progreso ────────────────
  document.getElementById('acadi-extractor-ui')?.remove();
  const ui = Object.assign(document.createElement('div'), {
    id: 'acadi-extractor-ui',
    innerHTML: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:#4fc3f7;font-size:15px">🎓 ACADi Extractor</b>
        <span id="acadi-close" style="cursor:pointer;font-size:18px;color:#aaa" title="Cerrar">✕</span>
      </div>
      <div id="acadi-status" style="color:#ffb74d;margin-bottom:6px">Iniciando...</div>
      <div id="acadi-log"   style="max-height:300px;overflow-y:auto;font-size:12px;line-height:1.6"></div>
    `
  });
  Object.assign(ui.style, {
    position:'fixed', top:'20px', right:'20px', zIndex:'2147483647',
    background:'#1a1a2e', color:'#e0e0e0', padding:'16px', borderRadius:'12px',
    maxWidth:'420px', width:'420px', fontFamily:'monospace', fontSize:'13px',
    boxShadow:'0 6px 30px rgba(0,0,0,0.7)', border:'1px solid #333'
  });
  document.body.appendChild(ui);
  document.getElementById('acadi-close').onclick = () => ui.remove();

  const $status = () => document.getElementById('acadi-status');
  const $log    = () => document.getElementById('acadi-log');

  function log(msg, type = 'info') {
    const color = { info:'#ccc', success:'#81c784', error:'#e57373', warn:'#ffb74d' }[type];
    $log().insertAdjacentHTML('beforeend', `<div style="color:${color}">${msg}</div>`);
    $log().scrollTop = $log().scrollHeight;
    console.log('[ACADi]', msg);
  }
  function status(msg) { $status().textContent = msg; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── HELPERS ─────────────────────────────────────────
  async function fetchDoc(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new DOMParser().parseFromString(await r.text(), 'text/html');
  }

  async function fetchJSON(url) {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ── PASO 1 – obtener lista de lecciones ─────────────
  status('📚 Obteniendo estructura del curso…');
  log(`Curso ID: ${COURSE_ID}`);

  let lessons = [];  // [{ id, name, type, url }]

  // Intento 1 – API interna de Thinkific
  try {
    const chapRes = await fetchJSON(`${BASE}/api/v1/chapters?course_id=${COURSE_ID}`);
    const chapters = chapRes.chapters ?? [];
    log(`API: ${chapters.length} capítulos`, 'success');

    for (const ch of chapters) {
      const contRes = await fetchJSON(`${BASE}/api/v1/contents?chapter_id=${ch.id}`);
      for (const c of contRes.contents ?? []) {
        lessons.push({
          id:    c.id,
          name:  c.name ?? 'Sin nombre',
          type:  c.content_type ?? 'unknown',
          chapterName: ch.name,
          url:   `${BASE}/manage/courses/${COURSE_ID}/contents/${c.id}`
        });
      }
      await sleep(DELAY_MS);
    }
    log(`✅ ${lessons.length} lecciones via API`, 'success');
  } catch (e) {
    log(`⚠️  API falló (${e.message}), leyendo DOM…`, 'warn');
  }

  // Intento 2 – Parsear el HTML del panel de gestión
  if (lessons.length === 0) {
    try {
      const doc = await fetchDoc(`${BASE}/manage/courses/${COURSE_ID}/`);
      const seen = new Set();
      doc.querySelectorAll('a[href*="/contents/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (!href || seen.has(href)) return;
        seen.add(href);
        lessons.push({
          name: a.textContent.trim() || 'Lección',
          url:  href.startsWith('http') ? href : `${BASE}${href}`
        });
      });
      log(`✅ ${lessons.length} lecciones via DOM`, 'success');
    } catch (e) {
      log(`❌ No se pudo leer el curso: ${e.message}`, 'error');
      return;
    }
  }

  if (lessons.length === 0) {
    log('❌ No se encontraron lecciones. ¿Estás en la página del curso?', 'error');
    return;
  }

  // ── PASO 2 – procesar cada lección ──────────────────
  const courseData = {
    extractedAt: new Date().toISOString(),
    courseId: COURSE_ID,
    baseUrl:  BASE,
    totalLessons: lessons.length,
    lessons: []
  };

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    status(`[${i+1}/${lessons.length}] ${lesson.name}`);
    log(`\n── [${i+1}/${lessons.length}] ${lesson.name}`);

    const data = {
      id:          lesson.id,
      name:        lesson.name,
      type:        lesson.type,
      chapterName: lesson.chapterName,
      url:         lesson.url,
      pdfs:        [],
      videos:      [],
      textSections:{},
      rawText:     '',
      quiz:        []
    };

    try {
      const doc = await fetchDoc(lesson.url);

      // ── PDFs / descargas ──────────────────────────
      [
        'a[href$=".pdf"]',
        'a[href*=".pdf?"]',
        'a[href*="download"]',
        'a[download]',
        '[class*="download"] a',
        'button[data-download-url]'
      ].forEach(sel => {
        doc.querySelectorAll(sel).forEach(el => {
          const href = el.href || el.dataset.downloadUrl;
          if (!href || data.pdfs.find(p => p.url === href)) return;
          data.pdfs.push({ label: el.textContent.trim() || 'Descargar', url: href });
          log(`  📥 PDF: ${el.textContent.trim()}`, 'success');
        });
      });

      // ── Videos (Vimeo, YouTube, etc.) ─────────────
      doc.querySelectorAll('iframe, video, [data-provider]').forEach(el => {
        const src = el.src || el.getAttribute('data-src') || el.dataset.src || '';
        if (!src) return;

        const vimeoId = src.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1]
                     || src.match(/player\.vimeo\.com\/video\/(\d+)/)?.[1];
        if (vimeoId) {
          data.videos.push({
            platform:   'vimeo',
            id:         vimeoId,
            embedUrl:   src,
            directUrl:  `https://vimeo.com/${vimeoId}`,
            playerUrl:  `https://player.vimeo.com/video/${vimeoId}`
          });
          log(`  🎬 Vimeo: https://vimeo.com/${vimeoId}`, 'success');
          return;
        }

        const ytMatch = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          data.videos.push({
            platform:  'youtube',
            id:        ytMatch[1],
            embedUrl:  src,
            directUrl: `https://www.youtube.com/watch?v=${ytMatch[1]}`
          });
          log(`  🎬 YouTube: ${ytMatch[1]}`, 'success');
        }
      });

      // Vimeo en links directos
      doc.querySelectorAll('a[href*="vimeo.com"]').forEach(a => {
        if (!data.videos.find(v => v.directUrl === a.href)) {
          const vId = a.href.match(/vimeo\.com\/(\d+)/)?.[1];
          data.videos.push({ platform:'vimeo', id:vId, directUrl:a.href, embedUrl:null });
          log(`  🔗 Vimeo link: ${a.href}`, 'success');
        }
      });

      // ── Secciones de texto ────────────────────────
      const SECTIONS = {
        'propósito':       ['propósito','proposito','purpose','objetivo'],
        'teoría':          ['teoría','teoria','theory','marco teórico','contenido teórico'],
        'aplicación':      ['aplicación','aplicacion','application','practica','práctica'],
        'reflexión':       ['reflexión','reflexion','reflection','reflexiona'],
        'experimentación': ['experimentación','experimentacion','experiment','experimenta']
      };

      const headings = [...doc.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,strong,b,.section-title,[class*="section-header"]'
      )];

      for (const [secName, kws] of Object.entries(SECTIONS)) {
        const found = headings.find(h =>
          kws.some(kw => h.textContent.toLowerCase().includes(kw))
        );
        if (!found) continue;

        let content = '';
        let el = found.nextElementSibling || found.parentElement?.nextElementSibling;
        let guard = 0;
        while (el && guard++ < 30) {
          if (/^H[1-6]$/.test(el.tagName)) break;
          const t = el.textContent.trim();
          if (t) content += t + '\n\n';
          el = el.nextElementSibling;
        }
        if (content.trim()) {
          data.textSections[secName] = content.trim();
          log(`  📝 ${secName}: ${content.slice(0,60).replace(/\n/g,' ')}…`, 'success');
        }
      }

      // Texto completo del cuerpo principal como respaldo
      const main = doc.querySelector(
        'main, .lesson-content, [class*="lesson-body"], article, .content-body, #content'
      );
      if (main) {
        data.rawText = main.textContent.trim().slice(0, 8000);
      }

      // ── Quiz / Test ───────────────────────────────
      const QUIZ_SEL = [
        '.quiz-question','[class*="quiz-question"]',
        '.question-container','[class*="question-container"]',
        '[data-question]','[class*="exam-question"]'
      ].join(',');

      doc.querySelectorAll(QUIZ_SEL).forEach(qEl => {
        const qText = (
          qEl.querySelector('[class*="question-text"],[class*="prompt"],h3,h4,p')
             ?.textContent.trim()
        );
        const options = [];

        qEl.querySelectorAll(
          'label,[class*="answer"],[class*="option"],input[type=radio],input[type=checkbox]'
        ).forEach(aEl => {
          const correct = aEl.classList.contains('correct')
            || aEl.dataset.correct === 'true'
            || !!aEl.closest('[class*="correct"]');
          const label = aEl.closest?.('label') || aEl.nextElementSibling;
          options.push({
            text:      (label?.textContent || aEl.value || '').trim(),
            isCorrect: correct
          });
        });

        if (qText || options.length) {
          data.quiz.push({ question: qText ?? '(sin texto)', options });
          log(`  ❓ ${qText?.slice(0,55) ?? ''}…`, 'success');
        }
      });

    } catch (err) {
      data.error = err.message;
      log(`  ❌ Error: ${err.message}`, 'error');
    }

    courseData.lessons.push(data);
    await sleep(DELAY_MS);
  }

  // ── PASO 3 – resumen y descarga ──────────────────────
  status('✅ Completado — descargando archivo…');
  const pdfTotal   = courseData.lessons.reduce((n,l) => n + l.pdfs.length, 0);
  const videoTotal = courseData.lessons.reduce((n,l) => n + l.videos.length, 0);
  const quizTotal  = courseData.lessons.reduce((n,l) => n + l.quiz.length, 0);

  log(`\n════════════════════════════`);
  log(`✅ Lecciones procesadas : ${courseData.lessons.length}`, 'success');
  log(`📥 PDFs encontrados     : ${pdfTotal}`,   pdfTotal   ? 'success' : 'warn');
  log(`🎬 Videos encontrados   : ${videoTotal}`, videoTotal ? 'success' : 'warn');
  log(`❓ Preguntas de quiz    : ${quizTotal}`,  quizTotal  ? 'success' : 'warn');

  // Descargar JSON con todo el contenido
  const fileName = `acadi_curso_${COURSE_ID}_${new Date().toISOString().split('T')[0]}.json`;
  const blob = new Blob([JSON.stringify(courseData, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: fileName
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  log(`\n💾 Descargado: ${fileName}`, 'success');

  // Descargar PDFs uno por uno
  if (pdfTotal > 0) {
    log('\n📥 Descargando PDFs…', 'info');
    for (const lesson of courseData.lessons) {
      for (const pdf of lesson.pdfs) {
        const link = Object.assign(document.createElement('a'), {
          href: pdf.url,
          download: (pdf.label || 'documento') + '.pdf',
          target: '_blank'
        });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        await sleep(1200);
      }
    }
    log(`✅ ${pdfTotal} PDF(s) iniciados`, 'success');
  }

  log('\n🎉 ¡Todo listo!', 'success');
  console.log('[ACADi] Datos completos:', courseData);
  return courseData;

})();
