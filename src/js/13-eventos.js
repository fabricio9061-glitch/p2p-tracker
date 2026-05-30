function importarDatos(){
    if(!AppState.currentUser){alert('No hay usuario activo');return}
    const input=document.createElement('input');
    input.type='file';input.accept='.json,application/json';
    input.addEventListener('change',e=>{
        const file=e.target.files?.[0];if(!file)return;
        const reader=new FileReader();
        reader.onload=async evt=>{
            try{
                const txt=evt.target.result;
                const parsed=JSON.parse(txt);
                /* Aceptar formato nuevo (con _meta.datos) o legacy (datos directos) */
                const datos=parsed.datos&&parsed._meta?parsed.datos:parsed;
                /* Validación estructural */
                if(!datos||typeof datos!=='object'){alert('❌ Archivo inválido: no es un objeto JSON de datos.');return}
                const camposRequeridos=['operaciones','movimientos','transferencias','conversiones','bancos','lotes'];
                const faltantes=camposRequeridos.filter(c=>datos[c]===undefined);
                if(faltantes.length===camposRequeridos.length){
                    alert('❌ Archivo inválido: no contiene ninguno de los campos esperados (operaciones, bancos, etc.).');return;
                }
                /* Normalizar campos faltantes para que la app no reviente */
                camposRequeridos.forEach(c=>{if(datos[c]===undefined)datos[c]=(c==='bancos')?{}:[]});
                /* Validación de tipos: los arrays deben serlo, bancos debe ser objeto */
                const tiposMal=[];
                ['operaciones','movimientos','transferencias','conversiones','lotes'].forEach(c=>{
                    if(!Array.isArray(datos[c]))tiposMal.push(c);
                });
                if(typeof datos.bancos!=='object'||Array.isArray(datos.bancos))tiposMal.push('bancos');
                if(tiposMal.length){alert('❌ Archivo con tipos inválidos en: '+tiposMal.join(', '));return}
                /* Validar que los montos numéricos sean realmente números */
                let numericosMal=0;
                (datos.operaciones||[]).forEach(op=>{
                    if(typeof op.monto!=='number'||!isFinite(op.monto))numericosMal++;
                    if(op.tasa!==undefined&&(typeof op.tasa!=='number'||!isFinite(op.tasa)))numericosMal++;
                });
                (datos.movimientos||[]).forEach(m=>{
                    if(typeof m.monto!=='number'||!isFinite(m.monto))numericosMal++;
                });
                if(numericosMal>0){
                    if(!confirm(`⚠️ Se detectaron ${numericosMal} campos numéricos inválidos en el archivo. Esto puede causar errores de cálculo.\n\n¿Importar de todos modos?`))return;
                }
                if(esDatosVacios(datos)){
                    alert('⚠️ El archivo contiene un estado vacío. No se importará — sería destructivo.');return;
                }
                /* Resumen + confirmación */
                const meta=parsed._meta||{};
                let resumen=`¿Importar este respaldo?\n\n`;
                if(meta.user)resumen+=`👤 Usuario: ${meta.user}\n`;
                if(meta.exported_at){
                    try{resumen+=`📅 Exportado: ${new Date(meta.exported_at).toLocaleString('es-UY')}\n`}catch(e){}
                }
                if(meta.version)resumen+=`🏷️ App v${meta.version}\n`;
                resumen+=`\n📊 Contenido:\n`
                    +`  • ${(datos.operaciones||[]).length} operaciones\n`
                    +`  • ${(datos.movimientos||[]).length} ajustes\n`
                    +`  • ${(datos.transferencias||[]).length} transferencias\n`
                    +`  • ${(datos.conversiones||[]).length} conversiones\n`
                    +`  • ${(datos.lotes||[]).length} lotes USDT\n`
                    +`  • ${Object.values(datos.bancos||{}).filter(b=>b&&b.activo).length} bancos activos\n\n`;
                /* Advertencia si el archivo era de otro usuario */
                if(meta.user){
                    const actual=emailToUser(AppState.currentUser.email);
                    if(meta.user!==actual){
                        resumen+=`⚠️ ATENCIÓN: este archivo es del usuario "${meta.user}" pero estás logueado como "${actual}".\n`
                            +`Si confirmás, los datos se aplicarán a tu cuenta actual.\n\n`;
                    }
                }
                resumen+=`Esta acción reemplazará los datos actuales. El estado actual se guardará como respaldo previo.`;
                if(!confirm(resumen))return;
                await _aplicarRespaldo(datos,'importado desde archivo');
            }catch(ex){
                console.error('[P2P] Error importando:',ex);
                alert('❌ Error al leer el archivo: '+(ex.message||'formato inválido'));
            }
        };
        reader.onerror=()=>alert('❌ Error al leer el archivo.');
        reader.readAsText(file);
    });
    input.click();
}

/* ═══════════════════════════════════════
   §18 — EVENT LISTENERS (sin inline)
   ═══════════════════════════════════════ */