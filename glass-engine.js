const TARGET_CLASS = 'glass';

const Surfaces = {
    convexCircle: (x) => Math.sqrt(1 - (1 - x) ** 2),
    convex: (x) => (1 - (1 - x) ** 4) ** (1 / 4),
    concave: (x) => 1 - Math.sqrt(1 - (1 - x) ** 2),
    lip: (x) => {
        const cvx = (1 - (1 - (x * 2)) ** 4) ** (1 / 4);
        const ccv = (1 - Math.sqrt(1 - (1 - x) ** 2)) + 0.1;
        const smootherstep = 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
        return cvx * (1 - smootherstep) + ccv * smootherstep;
    }
};

const config = {
    radius: 16,
    blur: 2,
    glassThickness: 85,
    bezelWidth: 45,
    refractiveIndex: 1.75,
    specularOpacity: 0.5,
    specularAngle: 90,
    brightness: 0.85,
    surfaceType: 'convex',
    pixelRatio: 1 
};

function calculateDisplacementArray(cfg = config) {
    const samples = 128;
    const eta = 1 / cfg.refractiveIndex;
    const bezelHeightFn = Surfaces[cfg.surfaceType];

    function refract(normalX, normalY) {
        const dot = normalY;
        const k = 1 - eta * eta * (1 - dot * dot);
        if (k < 0) return null;
        const kSqrt = Math.sqrt(k);
        return [
            -(eta * dot + kSqrt) * normalX,
            eta - (eta * dot + kSqrt) * normalY
        ];
    }

    return Array.from({ length: samples }, (_, i) => {
        const x = i / samples;
        const y = bezelHeightFn(x);
        const dx = x < 1 ? 0.0001 : -0.0001;
        const y2 = bezelHeightFn(x + dx);
        const derivative = (y2 - y) / dx;
        const magnitude = Math.sqrt(derivative * derivative + 1);
        const normal = [-derivative / magnitude, -1 / magnitude];
        const refracted = refract(normal[0], normal[1]);

        if (!refracted) return 0;
        const remainingHeight = (y * cfg.bezelWidth) + cfg.glassThickness;
        return refracted[0] * (remainingHeight / refracted[1]);
    });
}

function calculateBorderIntersection(radius, cornerWidth, x, y) {
    const angleStart = Math.atan2(cornerWidth - radius, cornerWidth);
    const angleEnd = Math.atan2(cornerWidth, cornerWidth - radius);
    const aperture = angleEnd - angleStart;
    const pointAngleInSquare = Math.atan2(Math.abs(y), Math.abs(x));

    if (pointAngleInSquare <= angleStart || pointAngleInSquare >= angleEnd) {
        if (Math.abs(y) > Math.abs(x)) {
            return [Math.abs(x / y) * cornerWidth * Math.sign(x), cornerWidth * Math.sign(y)];
        } else {
            return [cornerWidth * Math.sign(x), Math.abs(y / x) * cornerWidth * Math.sign(y)];
        }
    } else {
        const pointAngleInCone = (pointAngleInSquare - angleStart) / (aperture / (Math.PI / 2));
        const intersectionX = Math.cos(pointAngleInCone);
        const intersectionY = Math.sin(pointAngleInCone);
        return [
            (cornerWidth - radius + intersectionX * radius) * Math.sign(x),
            (cornerWidth - radius + intersectionY * radius) * Math.sign(y)
        ];
    }
}

function generateMapImages(targetWidth, targetHeight, cfg = config) {
    const precomputed = calculateDisplacementArray(cfg);
    const maxDisplacement = Math.max(...precomputed.map(Math.abs)) || 1;
    
    const pr = cfg.pixelRatio;
    const w = Math.round(targetWidth * pr);
    const h = Math.round(targetHeight * pr);
    
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(w, h);
    const data = new Uint32Array(imageData.data.buffer);

    const sCanvas = document.createElement('canvas');
    sCanvas.width = w; sCanvas.height = h;
    const sCtx = sCanvas.getContext('2d');
    const sImageData = sCtx.createImageData(w, h);
    const sData = new Uint32Array(sImageData.data.buffer);

    const radius = Math.min(cfg.radius * pr, w / 2, h / 2);
    const bezel = Math.max(radius, Math.min(cfg.bezelWidth * pr, w / 2, h / 2));
    
    const widthBetweenCorners = w - bezel * 2;
    const heightBetweenCorners = h - bezel * 2;
    const radiusPlusOneSquared = (radius + 1) ** 2;

    const specAngleRad = (cfg.specularAngle * Math.PI) / 180;
    const specVec = [Math.cos(specAngleRad), Math.sin(specAngleRad)];

    for (let yBuffer = 0; yBuffer < h; yBuffer++) {
        for (let xBuffer = 0; xBuffer < w; xBuffer++) {
            const idx = yBuffer * w + xBuffer;
            const vx = xBuffer < bezel ? xBuffer - bezel : xBuffer >= w - bezel ? xBuffer - bezel - widthBetweenCorners : 0;
            const vy = yBuffer < bezel ? yBuffer - bezel : yBuffer >= h - bezel ? yBuffer - bezel - heightBetweenCorners : 0;

            const [intX, intY] = calculateBorderIntersection(radius, bezel, vx, vy);
            const distToCenterSq = vx * vx + vy * vy;
            const distToBorderSq = (intX - vx) ** 2 + (intY - vy) ** 2;

            const isInCornerSquare = Math.abs(vx) > bezel - radius && Math.abs(vy) > bezel - radius;
            const isOutsideRadius = isInCornerSquare && (Math.abs(vx) - (bezel - radius)) ** 2 + (Math.abs(vy) - (bezel - radius)) ** 2 >= radiusPlusOneSquared;

            const isInRefractiveArea = !isInCornerSquare || !isOutsideRadius;

            if (isInRefractiveArea) {
                const distCenter = Math.sqrt(distToCenterSq);
                const distBorder = Math.sqrt(distToBorderSq);
                const ratio = distBorder / (distCenter + distBorder);
                const bezelIdx = Math.round(ratio * (precomputed.length - 1));
                const dispValue = precomputed[bezelIdx] || 0;
                const opacity = isOutsideRadius ? 1 - distBorder : 1;

                const angle = Math.atan2(vy, vx);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                const dX = ((-cos * dispValue) / maxDisplacement);
                const dY = ((-sin * dispValue) / maxDisplacement);

                const r = Math.round(128 + dX * 127 * opacity);
                const g = Math.round(128 + dY * 127 * opacity);
                data[idx] = (255 << 24) | (0 << 16) | (g << 8) | r;

                const dot = Math.max(0, cos * specVec[0] + (-sin) * specVec[1]);
                const specEdgeDist = Math.max(0, 1 - (distBorder / (1.0 * pr)));
                const coeff = dot * Math.sqrt(1 - Math.pow(1 - specEdgeDist, 2));
                const color = Math.round(255 * coeff);
                const alpha = Math.round(color * coeff * opacity);
                sData[idx] = (alpha << 24) | (color << 16) | (color << 8) | color;
            } else {
                data[idx] = (255 << 24) | (0 << 16) | (128 << 8) | 128;
                sData[idx] = 0;
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
    sCtx.putImageData(sImageData, 0, 0);

    return { displacement: canvas.toDataURL(), specular: sCanvas.toDataURL(), maxScale: maxDisplacement };
}

function updateAllGlass() {
    const elements = document.querySelectorAll('.' + TARGET_CLASS);
    let container = document.getElementById('glass-filters-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'glass-filters-container';
        document.body.appendChild(container);
    }
    container.innerHTML = ''; 

    elements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const localConfig = { ...config };
        
        const attrRad = el.getAttribute('Radius');
        const attrBez = el.getAttribute('Bezel');
        const attrThk = el.getAttribute('Thickness');
        const attrBlr = el.getAttribute('Blur');
        const attrSha = el.getAttribute('Shadow');
        const attrRef = el.getAttribute('Refraction');
        const attrSpA = el.getAttribute('Specular-amount');
        const attrSpG = el.getAttribute('Specular-angle');
        const attrBrt = el.getAttribute('Backdrop-brightness') || el.getAttribute('Brightness');

        if (attrRad) localConfig.radius = parseFloat(attrRad);
        if (attrBez) localConfig.bezelWidth = parseFloat(attrBez);
        if (attrThk) localConfig.glassThickness = parseFloat(attrThk);
        if (attrBlr) localConfig.blur = parseFloat(attrBlr);
        if (attrRef) localConfig.refractiveIndex = parseFloat(attrRef);
        if (attrSpA) localConfig.specularOpacity = parseFloat(attrSpA);
        if (attrSpG) localConfig.specularAngle = parseFloat(attrSpG);
        if (attrBrt) localConfig.brightness = parseFloat(attrBrt);
        
        if (attrSha) {
            el.style.boxShadow = `0 4px ${parseFloat(attrSha)}px rgba(0,0,0,0.4)`;
        }

        const filterId = `glassFilter_${index}`;
        const maps = generateMapImages(rect.width, rect.height, localConfig);
        
        const svg = `
            <svg style="position:absolute; width:0; height:0;" color-interpolation-filters="sRGB">
                <filter id="${filterId}">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="${localConfig.blur}" result="blurred" />
                    <feComponentTransfer in="blurred" result="brightened">
                        <feFuncR type="linear" slope="${localConfig.brightness}" />
                        <feFuncG type="linear" slope="${localConfig.brightness}" />
                        <feFuncB type="linear" slope="${localConfig.brightness}" />
                    </feComponentTransfer>
                    <feImage href="${maps.displacement}" x="0" y="0" width="${rect.width}" height="${rect.height}" result="disp" preserveAspectRatio="none" />
                    <feImage href="${maps.specular}" x="0" y="0" width="${rect.width}" height="${rect.height}" result="spec" preserveAspectRatio="none" />
                    <feDisplacementMap in="brightened" in2="disp" scale="${maps.maxScale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
                    <feColorMatrix in="spec" type="luminanceToAlpha" result="specA" />
                    <feComponentTransfer in="specA" result="specO"><feFuncA type="linear" slope="${localConfig.specularOpacity}" /></feComponentTransfer>
                    <feFlood flood-color="white" result="white" />
                    <feComposite in="white" in2="specO" operator="in" result="specMask" />
                    <feComposite in="specMask" in2="displaced" operator="over" />
                </filter>
            </svg>`;
        container.insertAdjacentHTML('beforeend', svg);

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        if (isSafari) {
            const fallbackStyle = `blur(${Math.max(localConfig.blur, 15)}px) brightness(${localConfig.brightness})`;
            el.style.backdropFilter = fallbackStyle;
            el.style.webkitBackdropFilter = fallbackStyle;
            el.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
            el.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        } else {
            el.style.backdropFilter = `url(#${filterId})`;
            el.style.backgroundColor = 'transparent';
            el.style.border = 'none';
        }
        el.style.borderRadius = `${localConfig.radius}px`;
    });
}

window.GlassEngine = { config, updateAllGlass, generateMapImages };

window.addEventListener('load', updateAllGlass);
window.addEventListener('resize', () => { clearTimeout(window.gRT); window.gRT = setTimeout(updateAllGlass, 150); });
