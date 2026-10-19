/**
 * TESOURARIA — Loader via Google Drive (implante UMA VEZ, nunca mais precisa mexer)
 *
 * O código real está em um arquivo .gs no seu Google Drive.
 * Para atualizar: Drive app → arquivo → ⋮ → Gerenciar versões → Enviar nova versão
 * O ID do arquivo não muda. Cache de 1h — ou use "⟳ Script" no app para forçar reload.
 *
 * SETUP:
 *   1. Suba Tesouraria_v3.gs para uma pasta no Google Drive
 *   2. Abra o arquivo → copie o ID da URL (trecho entre /d/ e /view)
 *   3. Cole em CODE_FILE_ID abaixo
 *   4. Implante este loader como App da Web (Eu / Qualquer pessoa)
 */

const CODE_FILE_ID = "1VOY28Nj9ifeopMHgS-GlE_AEQ6-mj9Op";
// [NOVO 19/10] O codigo agora e buscado primeiro no GitHub (Claude atualiza la, voce nao copia nada).
// Se o GitHub falhar ou devolver algo suspeito (vazio/cortado), cai no arquivo do Drive acima, como antes.
const CODE_URL     = "https://raw.githubusercontent.com/marcusseco78/Tesouraria/main/Tesouraria_v3.txt";
const CACHE_KEY    = "tesouraria_v3_code";
const CACHE_TTL    = 3600; // 1 hora

// [NOVO 16/10] O codigo (~650KB) passou muito do limite de 100KB por valor do
// CacheService, entao o cache NUNCA funcionava: toda chamada lia o arquivo
// inteiro do Drive. Agora o texto e guardado em PEDACOS de 30000 caracteres
// (cada um bem abaixo do limite, mesmo com acentos) e remontado. Se algo falhar,
// cai na leitura direta do Drive, como antes -- nunca quebra por causa do cache.
const CACHE_CHUNK = 30000;
var _ULT_CACHE_HIT = false;
var _ULT_ORIGEM = "";

// Texto so e aceito se parecer o script inteiro (tamanho + marcadores do comeco e do fim).
function _codigoValido(t) {
  return !!t && t.length > 300000 &&
         t.indexOf("function dispatch(") >= 0 &&
         t.indexOf("function _updateConfig") >= 0 &&
         t.indexOf("// VERSAO:") >= 0;
}

function _lerCodigoFonte() {
  try {
    const r = UrlFetchApp.fetch(CODE_URL + "?t=" + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const t = r.getContentText("UTF-8");
      if (_codigoValido(t)) { _ULT_ORIGEM = "github"; return t; }
    }
  } catch (e) {
    // sem internet/permissao -> Drive
  }
  _ULT_ORIGEM = "drive";
  return DriveApp.getFileById(CODE_FILE_ID).getBlob().getDataAsString("UTF-8");
}

function _chunkKeys(n) {
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(CACHE_KEY + "_" + i);
  return keys;
}

function _limparCacheCodigo() {
  const cache = CacheService.getScriptCache();
  const n = parseInt(cache.get(CACHE_KEY + "_n") || "0", 10) || 0;
  const keys = _chunkKeys(n);
  keys.push(CACHE_KEY + "_n");
  keys.push(CACHE_KEY); // chave antiga (versao anterior do loader)
  cache.removeAll(keys);
}

function _getCode() {
  const cache = CacheService.getScriptCache();
  _ULT_CACHE_HIT = false;
  try {
    const n = parseInt(cache.get(CACHE_KEY + "_n") || "0", 10) || 0;
    if (n > 0) {
      const keys = _chunkKeys(n);
      const got = cache.getAll(keys);
      const parts = [];
      let completo = true;
      for (let i = 0; i < keys.length; i++) {
        const v = got[keys[i]];
        if (v === null || v === undefined) { completo = false; break; }
        parts.push(v);
      }
      if (completo) {
        _ULT_CACHE_HIT = true;
        return parts.join("");
      }
    }
  } catch (e) {
    // sem cache -> le do Drive
  }

  const code = _lerCodigoFonte();

  if (code && code.length > 200) {
    try {
      const obj = {};
      const total = Math.ceil(code.length / CACHE_CHUNK);
      for (let i = 0; i < total; i++) {
        obj[CACHE_KEY + "_" + i] = code.substring(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
      }
      obj[CACHE_KEY + "_n"] = String(total);
      cache.putAll(obj, CACHE_TTL);
    } catch (e) {
      // Silencioso de proposito -- sem cache o app continua funcionando.
    }
  }
  return code;
}

function doPost(e) {
  const out = ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const p = JSON.parse(e.postData.contents);

    if (p.action === "reloadCode") {
      _limparCacheCodigo();
      out.setContent(JSON.stringify({ ok: true, message: "Código será recarregado na próxima ação (GitHub, ou Drive se falhar)." }));
      return out;
    }

    const T0 = Date.now();
    const codigo = _getCode();
    const T1 = Date.now();
    eval(codigo);
    const T2 = Date.now();
    const res = dispatch(p);
    const T3 = Date.now();
    out.setContent(JSON.stringify({
      ok: true, ...res,
      _timing: { codigoMs: T1 - T0, evalMs: T2 - T1, acaoMs: T3 - T2, totalMs: T3 - T0, cacheHit: _ULT_CACHE_HIT, origem: _ULT_CACHE_HIT ? "cache" : _ULT_ORIGEM }
    }));

  } catch(err) {
    out.setContent(JSON.stringify({ ok: false, error: err.message }));
  }
  return out;
}

function doGet() {
  try {
    const file = DriveApp.getFileById(CODE_FILE_ID);
    return ContentService.createTextOutput(JSON.stringify({
      status:    "ok",
      loader:    "github-1.0",
      arquivo:   file.getName(),
      atualizado: file.getLastUpdated().toISOString(),
      cacheAtivo: !!CacheService.getScriptCache().get(CACHE_KEY + "_n")
    })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "erro", error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * [NOVO 16/07] Funcao REAL (fora do eval) pra servir de alvo do trigger de
 * horario -- o Google so consegue chamar, via agendamento, uma funcao que
 * exista de verdade neste arquivo, nunca uma que só existe dentro do texto
 * avaliado em tempo de execucao (era exatamente esse o problema: nenhuma
 * virada automatica rodou ate hoje porque essa funcao nunca existiu aqui).
 *
 * CUIDADO: viradaCiclo() nao tem protecao contra rodar duas vezes pro mesmo
 * ciclo -- duplica recorrencia fixa gerada e avanca contador de parcela em
 * dobro. So chamar esta funcao manualmente se tiver certeza que a virada de
 * hoje AINDA NAO foi feita por nenhum outro caminho (ex: botao temporario
 * no app). O uso normal dela e so via trigger automatico, uma vez por mes.
 */
function triggerViradaCiclo() {
  eval(_getCode());
  viradaCiclo(getTargetSpreadsheet());
}

/**
 * Rodar UMA VEZ, manualmente, no editor (menu Executar, com esta funcao
 * selecionada no dropdown). Cria o agendamento de horario que chama
 * triggerViradaCiclo (a funcao real acima) todo dia 16 as 8h. So precisa
 * rodar esta uma vez -- o trigger fica salvo e sobrevive a qualquer
 * atualizacao futura do TXT no Drive (nao mexe no codigo real, so agenda).
 * Nao tem efeito nenhum na planilha por si so -- pode rodar quantas vezes
 * quiser sem risco, o filter no comeco sempre remove o agendamento antigo
 * antes de recriar.
 */
function setupViradaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === "triggerViradaCiclo"; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("triggerViradaCiclo")
    .timeBased().onMonthDay(16).atHour(8).create();
  Logger.log("Trigger configurado: virada todo dia 16 as 8h.");
}

/**
 * Rodar UMA VEZ, manualmente, no editor (selecione esta funcao e toque Executar).
 * O Google vai pedir autorizacao nova (acesso a servicos externos) -- aceite.
 * Depois olhe o log: deve dizer "origem: github" e a VERSAO do script.
 */
function testarGitHub() {
  _limparCacheCodigo();
  const t = _lerCodigoFonte();
  const m = /\/\/ VERSAO: (\S+)/.exec(t);
  Logger.log("origem: " + _ULT_ORIGEM + " | tamanho: " + t.length + " | versao: " + (m ? m[1] : "?"));
}
