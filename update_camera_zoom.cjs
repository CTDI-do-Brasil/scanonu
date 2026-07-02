const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Add zoom states
if (!code.includes('const [zoomLevel, setZoomLevel]')) {
  code = code.replace(
    /const \[screen, setScreen\] = useState\<'idle' \| 'camera' \| 'processing' \| 'result'\>\('idle'\);/,
    `const [screen, setScreen] = useState<'idle' | 'camera' | 'processing' | 'result'>('idle');\n  const [zoomLevel, setZoomLevel] = useState(1);\n  const [minZoom, setMinZoom] = useState(1);\n  const [maxZoom, setMaxZoom] = useState(1);\n  const [isZoomSupported, setIsZoomSupported] = useState(false);`
  );
}

// 2. Modify startCamera to configure auto-zoom
const newStartCamera = `  const startCamera = async () => {
    setError(null);
    setScreen('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // CONFIGURAR ZOOM AUTOMÁTICO (Auto-Zoom)
      const [videoTrack] = stream.getVideoTracks();
      const capabilities = videoTrack.getCapabilities() as any;
      if (capabilities && capabilities.zoom) {
        setIsZoomSupported(true);
        setMinZoom(capabilities.zoom.min || 1);
        setMaxZoom(capabilities.zoom.max || 1);
        
        // Aplica um zoom de 2.5x por padrão (ou o máximo se for menor que 2.5)
        const targetZoom = Math.min(2.5, capabilities.zoom.max || 1);
        setZoomLevel(targetZoom);
        await videoTrack.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any);
      } else {
        setIsZoomSupported(false);
      }
      
    } catch (err: any) {
      console.error('Erro ao acessar a câmera:', err);
      setError('Não foi possível acessar a câmera. Verifique se deu permissão ou utilize a Galeria.');
      setScreen('idle');
    }
  };`;

code = code.replace(
  /const startCamera = async \(\) => \{[\s\S]*?\}\s*catch\s*\(err: any\)\s*\{[\s\S]*?setScreen\('idle'\);\s*\}\s*\};/,
  newStartCamera
);

// 3. Add handleZoomChange function
const newZoomHandler = `
  const handleZoomChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setZoomLevel(newZoom);
    if (streamRef.current) {
      const [videoTrack] = streamRef.current.getVideoTracks();
      try {
        await videoTrack.applyConstraints({ advanced: [{ zoom: newZoom }] } as any);
      } catch (err) {
        console.error('Erro ao aplicar zoom:', err);
      }
    }
  };

  const stopCameraStream = () => {`;

code = code.replace(
  /const stopCameraStream = \(\) => \{/,
  newZoomHandler
);

// 4. Add slider UI to camera screen overlay
const oldStreamDiv = `                {/* Stream de Vídeo com Guia Retícula */}
                <div className="relative flex-1 bg-neutral-950 flex items-center justify-center overflow-hidden">
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  
                  {/* Guia Visual Redesenhado */}
                  <div className="relative z-10 w-64 h-64 border-2 border-white/50 rounded-2xl flex flex-col items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#00d2ff] rounded-tl-xl -mt-1 -ml-1"></div>
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#00d2ff] rounded-tr-xl -mt-1 -mr-1"></div>
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#00d2ff] rounded-bl-xl -mb-1 -ml-1"></div>
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#00d2ff] rounded-br-xl -mb-1 -mr-1"></div>
                    <Scan className="w-10 h-10 text-white/30 mb-2" />
                    <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest text-center px-4">
                      Alinhe a Etiqueta<br/>aqui
                    </p>
                  </div>
                </div>`;

const newStreamDiv = `                {/* Stream de Vídeo com Guia Retícula */}
                <div className="relative flex-1 bg-neutral-950 flex flex-col items-center justify-center overflow-hidden">
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  
                  {/* Guia Visual Redesenhado */}
                  <div className="relative z-10 w-64 h-64 border-2 border-white/50 rounded-2xl flex flex-col items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#00d2ff] rounded-tl-xl -mt-1 -ml-1"></div>
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#00d2ff] rounded-tr-xl -mt-1 -mr-1"></div>
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#00d2ff] rounded-bl-xl -mb-1 -ml-1"></div>
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#00d2ff] rounded-br-xl -mb-1 -mr-1"></div>
                    <Scan className="w-10 h-10 text-white/30 mb-2" />
                    <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest text-center px-4">
                      Alinhe a Etiqueta<br/>aqui
                    </p>
                  </div>

                  {/* Controle de Zoom */}
                  {isZoomSupported && (
                    <div className="absolute bottom-10 w-3/4 max-w-sm z-20 bg-black/50 backdrop-blur-md rounded-2xl p-4 flex items-center gap-3">
                      <span className="text-white font-bold text-xs">{(zoomLevel).toFixed(1)}x</span>
                      <input 
                        type="range" 
                        min={minZoom} 
                        max={maxZoom} 
                        step="0.1" 
                        value={zoomLevel} 
                        onChange={handleZoomChange}
                        className="w-full accent-[#00d2ff]"
                      />
                    </div>
                  )}
                </div>`;

// Using split/join to avoid regex mismatch on large HTML blocks with special characters
if (code.includes('Stream de V')) { // using partial to match if encoding is weird
    // Just find the block starting with '{/* Stream de Vídeo com Guia Retícula */}' and ending with '</div>' after the '<p>'
    code = code.replace(/\{\/\* Stream de V..deo com Guia Ret.cula \*\/\}[\s\S]*?aqui\s*<\/p>\s*<\/div>\s*<\/div>/, newStreamDiv);
}

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx camera zoom implemented safely.');
