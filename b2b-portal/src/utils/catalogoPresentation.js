/**
 * Helpers de presentación comercial, normalización de stock, claves jerárquicas
 * deterministas y encabezados limpios no redundantes para Portal B2B.
 */

const EPSILON_CERO = 1e-4;
const EPSILON_ENTERO = 1e-3;

const CONECTORES_MINUSCULA = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'para', 'con', 'sin', 'y', 'o', 'en', 'a']);
const ACRONIMOS_MAYUSCULA = new Set(['NP', 'HF', 'IDP', 'MM', 'MIC', 'W4', 'W5', 'P3', 'BBQ']);

/**
 * Normaliza texto para comparaciones, claves jerárquicas y búsqueda universal
 * (insensible a tildes y mayúsculas, colapsando espacios).
 */
export function normalizarTextoBusqueda(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Elimina ruido de punto flotante IEEE-754 en cantidades de stock comercial.
 */
export function normalizarStockComercial(val) {
  const n = Number(val || 0);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) < EPSILON_CERO) return 0;

  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < EPSILON_ENTERO) {
    return rounded === 0 ? 0 : rounded;
  }

  const dosDec = Math.round(n * 100) / 100;
  return Math.abs(dosDec) < EPSILON_CERO ? 0 : dosDec;
}

/**
 * Formatea una cantidad de stock limpia para mostrar en UI.
 */
export function formatearStockComercial(val) {
  return String(normalizarStockComercial(val));
}

function normalizarUnidadTexto(rawUnit) {
  const u = String(rawUnit || '').toLowerCase().replace(/\.$/, '');
  if (u === 'k' || u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilos') return 'kg';
  if (u === 'gr' || u === 'g' || u === 'grs') return 'g';
  if (u === 'u' || u === 'un' || u === 'unid' || u === 'unidad' || u === 'unidades') return 'u.';
  return u;
}

function formatearNumeroMedida(rawNum) {
  return String(rawNum || '').trim().replace(/,0+(?=$)/, '');
}

/**
 * Separa una descripción comercial en `{ stem, presentation, isPack }`
 * conservando íntegramente el peso/formato de presentación al final.
 */
export function extraerBaseYPresentacion(descripcion, product = null) {
  const raw = String(descripcion || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return { stem: '', presentation: '', isPack: false };
  }

  // Pack: "... 10 x 500g", "... x 10 x 500g", "... Pack 10 x 500 g."
  const rePack = /^(.*?)\s+(?:(?:pack|caja)\s*(?:de\s*)?[xX×]?\s*|[xX×]\s*)?(\d+)\s*[xX×]\s*([\d.,]+)\s*(kg|k|kgs|kilo|kilos|gr|grs|g|u|un|unid|unidad|unidades)\.?\s*$/i;
  const mPack = raw.match(rePack);
  if (mPack && mPack[1].trim().length >= 3) {
    const mult = mPack[2];
    const med = formatearNumeroMedida(mPack[3]);
    const unit = normalizarUnidadTexto(mPack[4]);
    return {
      stem: mPack[1].trim(),
      presentation: `Pack ${mult} x ${med} ${unit}`,
      isPack: true
    };
  }

  // Bulto o fraccionado simple: "... x 25kg", "... x 500 g", "... x 1.5kg"
  const reSimple = /^(.*?)\s+[xX×]\s*([\d.,]+)\s*(kg|k|kgs|kilo|kilos|gr|grs|g|u|un|unid|unidad|unidades)\.?\s*$/i;
  const mSimple = raw.match(reSimple);
  if (mSimple && mSimple[1].trim().length >= 3) {
    const med = formatearNumeroMedida(mSimple[2]);
    const unit = normalizarUnidadTexto(mSimple[3]);
    return {
      stem: mSimple[1].trim(),
      presentation: `x ${med} ${unit}`,
      isPack: false
    };
  }

  // Fallback por kilos_unidad si no tiene sufijo estándar
  const kilos = Number(product?.kilos_unidad || 0);
  if (kilos > 0) {
    const unitLabel = kilos < 1
      ? `${Math.round(kilos * 1000)} g`
      : `${Number.isInteger(kilos) ? kilos : Number(kilos.toFixed(2))} kg`;
    return { stem: raw, presentation: `x ${unitLabel}`, isPack: false };
  }

  return { stem: raw, presentation: raw, isPack: false };
}

/**
 * Embellece un título base expandiendo abreviaturas internas del Búnker y
 * corrigiendo mayúsculas/conectores sin inventar palabras ni duplicar términos.
 */
export function embellecerTituloComercial(rawStem) {
  let s = String(rawStem || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Expansiones idiomáticas deterministas de abreviaturas internas
  s = s
    .replace(/\bGRANA\s+(?:de\s+)?(Flor|Sol)\b/gi, (_, varName) => `Granola de ${varName.charAt(0).toUpperCase() + varName.slice(1).toLowerCase()}`)
    .replace(/\bGrana\s+(?:de\s+)?(Flor|Sol)\b/gi, (_, varName) => `Granola de ${varName.charAt(0).toUpperCase() + varName.slice(1).toLowerCase()}`)
    .replace(/\bF\/SCOS\b/gi, 'Frutos Secos')
    .replace(/\bERRDA\b/gi, 'Escurrida')
    .replace(/\bTOST\/SAL\b/gi, 'Tostado y Salado')
    .replace(/\bS\/CAZO\b/gi, 'Sin Carozo')
    .replace(/\bC\/ZO\b/gi, 'Con Carozo')
    .replace(/\bS\/PIEL\b/gi, 'Sin Piel')
    .replace(/\bC\/PIEL\b/gi, 'Con Piel')
    .replace(/\bTOTDO\b/gi, 'Tostado')
    .replace(/\bMDIO\b/gi, 'Mediano')
    .replace(/\bIGRAL\b/gi, 'Integral');

  const tokens = s.split(' ').filter(Boolean);
  const formatted = [];

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    const upper = tok.toUpperCase();
    const lower = tok.toLowerCase();

    if (ACRONIMOS_MAYUSCULA.has(upper)) {
      tok = upper;
    } else if (i > 0 && CONECTORES_MINUSCULA.has(lower)) {
      tok = lower;
    } else if (tok === upper && tok.length >= 3 && /^[A-ZÁÉÍÓÚÑ]+$/.test(tok)) {
      // Palabra completamente en MAYÚSCULA -> Capitalizar solo la primera letra
      tok = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    } else if (i === 0) {
      tok = tok.charAt(0).toUpperCase() + tok.slice(1);
    }

    // Evitar repetición consecutiva idéntica (ej: "Mix Mix")
    if (formatted.length > 0 && normalizarTextoBusqueda(formatted[formatted.length - 1]) === normalizarTextoBusqueda(tok)) {
      continue;
    }
    formatted.push(tok);
  }

  return formatted.join(' ').trim();
}

function tokenizarStemComparable(stem) {
  return normalizarTextoBusqueda(embellecerTituloComercial(stem))
    .split(' ')
    .filter(t => t && !['de', 'del'].includes(t));
}

function tokenizarStemLiteral(stem) {
  return String(embellecerTituloComercial(stem))
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Dado un grupo de artículos hoja, calcula:
 * - `titulo`: título común limpio y no redundante para el encabezado
 * - `etiquetasPorCodigo`: Map(producto_codigo -> etiqueta compacta para cada tarjeta)
 */
export function calcularPresentacionGrupo(items, fallbackNombre = '') {
  const list = Array.isArray(items) ? items : [];
  const cleanFallback = embellecerTituloComercial(fallbackNombre) || String(fallbackNombre || '').trim();
  const etiquetasPorCodigo = new Map();

  if (list.length === 0) {
    return { titulo: cleanFallback, etiquetasPorCodigo, tieneTituloComun: false };
  }

  const parsed = list.map((item) => {
    const desc = item.producto_descripcion || item.descripcion || '';
    const ext = extraerBaseYPresentacion(desc, item);
    const emb = embellecerTituloComercial(ext.stem);
    const tokensLit = tokenizarStemLiteral(emb);
    const tokensNorm = tokensLit.map(normalizarTextoBusqueda);
    const tokensCmp = tokenizarStemComparable(ext.stem);
    return { item, desc, ext, emb, tokensLit, tokensNorm, tokensCmp };
  });

  // 1. Verificar si todos comparten exactamente el mismo stem (ignorando 'de'/'del' y mayúsculas)
  const firstCmpKey = parsed[0].tokensCmp.join(' ');
  const todosMismoStem = firstCmpKey.length > 0 && parsed.every(p => p.tokensCmp.join(' ') === firstCmpKey);

  if (todosMismoStem) {
    // Preferir la versión con conector si existe (ej: "Granola de Sol" mejor que "Granola Sol")
    const mejorVersion = parsed.reduce((acc, p) => (p.emb.length >= acc.length ? p.emb : acc), parsed[0].emb);
    for (const p of parsed) {
      const cod = String(p.item.producto_codigo || p.item.articulo_numero || p.desc).trim();
      etiquetasPorCodigo.set(cod, p.ext.presentation || p.desc);
    }
    return {
      titulo: mejorVersion || cleanFallback,
      etiquetasPorCodigo,
      tieneTituloComun: true
    };
  }

  // 2. Calcular prefijo común de tokens literales normalizados entre todos los ítems
  let prefijoLen = parsed[0].tokensNorm.length;
  for (let i = 1; i < parsed.length; i++) {
    let k = 0;
    const maxK = Math.min(prefijoLen, parsed[i].tokensNorm.length);
    while (k < maxK && parsed[0].tokensNorm[k] === parsed[i].tokensNorm[k]) {
      k++;
    }
    prefijoLen = k;
  }

  // Ajustar si quedó un conector colgando al final del prefijo común (ej: "Nuez de")
  while (prefijoLen > 1 && CONECTORES_MINUSCULA.has(parsed[0].tokensNorm[prefijoLen - 1])) {
    prefijoLen--;
  }

  if (prefijoLen >= 2) {
    const tituloPrefijo = parsed[0].tokensLit.slice(0, prefijoLen).join(' ');
    for (const p of parsed) {
      const cod = String(p.item.producto_codigo || p.item.articulo_numero || p.desc).trim();
      const resto = p.tokensLit.slice(prefijoLen).join(' ').trim();
      const pres = p.ext.presentation || '';
      const compacta = resto
        ? (pres ? `${resto} · ${pres}` : resto)
        : (pres || p.desc);
      etiquetasPorCodigo.set(cod, compacta);
    }
    return {
      titulo: tituloPrefijo || cleanFallback,
      etiquetasPorCodigo,
      tieneTituloComun: true
    };
  }

  // 3. Fallback heterogéneo: mostrar descripción completa en cada tarjeta para nunca perder información
  for (const p of parsed) {
    const cod = String(p.item.producto_codigo || p.item.articulo_numero || p.desc).trim();
    etiquetasPorCodigo.set(cod, p.desc);
  }
  return {
    titulo: cleanFallback,
    etiquetasPorCodigo,
    tieneTituloComun: false
  };
}

/**
 * Evalúa si todos los artículos visibles dentro de un grupo hoja comparten exactamente
 * la misma receta de ingredientes comerciales. Si todos coinciden, devuelve `{ shared: true, info, representative }`;
 * caso contrario devuelve `{ shared: false }` para que cada card mantenga fallback individual si aplica.
 */
export function evaluarIngredientesGrupo(items, mapaIngredientesComerciales, resolverFn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0 || typeof resolverFn !== 'function') {
    return { shared: false, info: null, representative: null };
  }

  let baseInfo = null;
  let baseFirma = null;

  for (const item of list) {
    const info = resolverFn(item, mapaIngredientesComerciales);
    if (!info || !Array.isArray(info.ingredientes) || info.ingredientes.length < 2) {
      return { shared: false, info: null, representative: null };
    }
    const firma = `${Number(info.linea_negocio || 0)}::${info.ingredientes.map(x => normalizarTextoBusqueda(x)).join('|')}`;
    if (!baseInfo) {
      baseInfo = info;
      baseFirma = firma;
    } else if (firma !== baseFirma) {
      return { shared: false, info: null, representative: null };
    }
  }

  return {
    shared: true,
    info: baseInfo,
    representative: list[0]
  };
}

/**
 * Construye el árbol jerárquico de 5 niveles para Portal B2B usando claves normalizadas
 * deterministas (NFD, minúsculas, sin espacios redundantes) para evitar cruces entre
 * variedades (ej. Flor vs Sol) y precalculando títulos limpios no redundantes,
 * etiquetas compactas por fracción e ingredientes compartidos por grupo hoja.
 */
export function construirArbolCatalogoB2B({
  products = [],
  getNormalizedFamilia,
  getNormalizedAtributoPrincipal,
  sortProductsByKilos,
  mapaIngredientesComerciales = {},
  resolverInfoIngredientes
}) {
  const famMap = new Map();

  for (const product of products) {
    const famName = getNormalizedFamilia(product);
    const famKey = normalizarTextoBusqueda(famName) || 'general';
    const atName = getNormalizedAtributoPrincipal(product);
    const atKey = normalizarTextoBusqueda(atName) || 'general';

    if (!famMap.has(famKey)) {
      famMap.set(famKey, { nombre: famName, key: famKey, atMap: new Map() });
    }
    const famObj = famMap.get(famKey);
    if (!famObj.atMap.has(atKey)) {
      famObj.atMap.set(atKey, { nombre: atName, key: `${famKey}___${atKey}`, prods: [] });
    }
    famObj.atMap.get(atKey).prods.push(product);
  }

  return Array.from(famMap.values())
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
    .map(({ nombre: famName, key: famKey, atMap }) => {
      const atributosList = Array.from(atMap.values())
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
        .map(({ nombre: atName, key: atKey, prods }) => {
          const subMap = new Map();
          let hasSubcategorias = false;

          for (const p of prods) {
            const subCat = p.sub_categoria?.trim();
            if (subCat && subCat !== '') {
              hasSubcategorias = true;
              const subKey = normalizarTextoBusqueda(subCat);
              if (!subMap.has(subKey)) {
                subMap.set(subKey, { nombre: subCat, subKey, subProds: [] });
              }
              subMap.get(subKey).subProds.push(p);
            }
          }

          let subcategoriasList = [];
          if (hasSubcategorias) {
            const sinSub = prods.filter(p => !p.sub_categoria || p.sub_categoria.trim() === '');
            if (sinSub.length > 0) {
              if (!subMap.has('general')) subMap.set('general', { nombre: 'General', subKey: 'general', subProds: [] });
              subMap.get('general').subProds.push(...sinSub);
            }

            subcategoriasList = Array.from(subMap.values())
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
              .map(({ nombre: subName, subKey, subProds }) => {
                const subPathKey = `${atKey}___${subKey}`;
                const subSubMap = new Map();
                let hasSubSubcategorias = false;

                for (const sp of subProds) {
                  const subSubCat = sp.sub_sub_categoria?.trim();
                  if (subSubCat && subSubCat !== '') {
                    hasSubSubcategorias = true;
                    const subSubKey = normalizarTextoBusqueda(subSubCat);
                    if (!subSubMap.has(subSubKey)) {
                      subSubMap.set(subSubKey, { nombre: subSubCat, subSubKey, subSubProds: [] });
                    }
                    subSubMap.get(subSubKey).subSubProds.push(sp);
                  }
                }

                let subSubcategoriasList = [];
                if (hasSubSubcategorias) {
                  const sinSubSub = subProds.filter(p => !p.sub_sub_categoria || p.sub_sub_categoria.trim() === '');
                  if (sinSubSub.length > 0) {
                    if (!subSubMap.has('general')) subSubMap.set('general', { nombre: 'General', subSubKey: 'general', subSubProds: [] });
                    subSubMap.get('general').subSubProds.push(...sinSubSub);
                  }

                  subSubcategoriasList = Array.from(subSubMap.values())
                    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
                    .map(({ nombre: subSubName, subSubKey, subSubProds }) => {
                      const subSubPathKey = `${subPathKey}___${subSubKey}`;
                      const subSubSubMap = new Map();
                      let hasSubSubSubcategorias = false;

                      for (const ssp of subSubProds) {
                        const subSubSubCat = ssp.sub_sub_sub_categoria?.trim();
                        if (subSubSubCat && subSubSubCat !== '') {
                          hasSubSubSubcategorias = true;
                          const subSubSubKey = normalizarTextoBusqueda(subSubSubCat);
                          if (!subSubSubMap.has(subSubSubKey)) {
                            subSubSubMap.set(subSubSubKey, { nombre: subSubSubCat, subSubSubKey, subSubSubProds: [] });
                          }
                          subSubSubMap.get(subSubSubKey).subSubSubProds.push(ssp);
                        }
                      }

                      let subSubSubcategoriasList = [];
                      if (hasSubSubSubcategorias) {
                        const sinSubSubSub = subSubProds.filter(p => !p.sub_sub_sub_categoria || p.sub_sub_sub_categoria.trim() === '');
                        if (sinSubSubSub.length > 0) {
                          if (!subSubSubMap.has('general')) subSubSubMap.set('general', { nombre: 'General', subSubSubKey: 'general', subSubSubProds: [] });
                          subSubSubMap.get('general').subSubSubProds.push(...sinSubSubSub);
                        }

                        subSubSubcategoriasList = Array.from(subSubSubMap.values())
                          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
                          .map(({ nombre: subSubSubName, subSubSubKey, subSubSubProds }) => {
                            const sorted = sortProductsByKilos(subSubSubProds);
                            return {
                              nombre: subSubSubName,
                              key: `${subSubPathKey}___${subSubSubKey}`,
                              productos: sorted,
                              presentacion: calcularPresentacionGrupo(sorted, subSubSubName),
                              ingGrupo: evaluarIngredientesGrupo(sorted, mapaIngredientesComerciales, resolverInfoIngredientes)
                            };
                          });
                      }

                      const sortedSubSub = sortProductsByKilos(subSubProds);
                      return {
                        nombre: subSubName,
                        key: subSubPathKey,
                        hasSubSubSubcategorias,
                        subSubSubcategorias: subSubSubcategoriasList,
                        productos: sortedSubSub,
                        presentacion: hasSubSubSubcategorias ? null : calcularPresentacionGrupo(sortedSubSub, subSubName),
                        ingGrupo: hasSubSubSubcategorias ? { shared: false, info: null, representative: null } : evaluarIngredientesGrupo(sortedSubSub, mapaIngredientesComerciales, resolverInfoIngredientes)
                      };
                    });
                }

                const sortedSub = sortProductsByKilos(subProds);
                return {
                  nombre: subName,
                  key: subPathKey,
                  hasSubSubcategorias,
                  subSubcategorias: subSubcategoriasList,
                  productos: sortedSub,
                  presentacion: hasSubSubcategorias ? null : calcularPresentacionGrupo(sortedSub, subName),
                  ingGrupo: hasSubSubcategorias ? { shared: false, info: null, representative: null } : evaluarIngredientesGrupo(sortedSub, mapaIngredientesComerciales, resolverInfoIngredientes)
                };
              });
          }

          const sortedProds = sortProductsByKilos(prods);
          return {
            nombre: atName,
            key: atKey,
            hasSubcategorias,
            subcategorias: subcategoriasList,
            productos: sortedProds,
            presentacion: hasSubcategorias ? null : calcularPresentacionGrupo(sortedProds, atName),
            ingGrupo: hasSubcategorias ? { shared: false, info: null, representative: null } : evaluarIngredientesGrupo(sortedProds, mapaIngredientesComerciales, resolverInfoIngredientes)
          };
        });

      const totalProds = atributosList.reduce((acc, at) => acc + at.productos.length, 0);
      return {
        nombre: famName,
        key: famKey,
        totalProductos: totalProds,
        atributos: atributosList
      };
    });
}
