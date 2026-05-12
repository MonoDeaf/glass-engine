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
    radius: 24,
    blur: 1,
    glassThickness: 85,
    bezelWidth: 45,
    refractiveIndex: 1.75,
    specularOpacity: 0.05,
    specularAngle: 90,
    brightness: 0.85,
    surfaceType: 'convex',
    resolutionScale: 0.7
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
    
    // Using resolutionScale to drastically reduce canvas size and overhead
    const pr = cfg.resolutionScale || 0.5;
    const w = Math.max(1, Math.round(targetWidth * pr));
    const h = Math.max(1, Math.round(targetHeight * pr));
    
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true });
    const imageData = ctx.createImageData(w, h);
    const data = new Uint32Array(imageData.data.buffer);

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

                // R: X-displacement, G: Y-displacement, B: Specular intensity
                const r = Math.round(128 + dX * 127 * opacity);
                const g = Math.round(128 + dY * 127 * opacity);
                
                const dot = Math.max(0, cos * specVec[0] + (-sin) * specVec[1]);
                const specEdgeDist = Math.max(0, 1 - (distBorder / (1.0 * pr)));
                const coeff = dot * Math.sqrt(1 - Math.pow(1 - specEdgeDist, 2));
                const b = Math.round(255 * coeff * opacity);

                data[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
            } else {
                data[idx] = (255 << 24) | (0 << 16) | (128 << 8) | 128;
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);

    return { combined: canvas.toDataURL('image/png'), maxScale: maxDisplacement };
}

function updateAllGlass() {
    const elements = document.querySelectorAll('.' + TARGET_CLASS);
    let container = document.getElementById('glass-filters-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'glass-filters-container';
        container.style.cssText = 'position:absolute; width:0; height:0; overflow:hidden; visibility:hidden; pointer-events:none;';
        document.body.appendChild(container);
    }
    container.innerHTML = ''; 

    elements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const localConfig = { ...config };
        
        const attrRad = el.getAttribute('radius');
        const attrBez = el.getAttribute('bezel');
        const attrThk = el.getAttribute('thickness');
        const attrBlr = el.getAttribute('blur');
        const attrSha = el.getAttribute('shadow');
        const attrRef = el.getAttribute('refraction');
        const attrSpA = el.getAttribute('specular-amount');
        const attrSpG = el.getAttribute('specular-angle');
        const attrBrt = el.getAttribute('backdrop-brightness') || el.getAttribute('brightness');

        const isValidValue = (v) => v !== null && v !== undefined && v !== 'null';

        if (isValidValue(attrRad)) localConfig.radius = parseFloat(attrRad);
        if (isValidValue(attrBez)) localConfig.bezelWidth = parseFloat(attrBez);
        if (isValidValue(attrThk)) localConfig.glassThickness = parseFloat(attrThk);
        if (isValidValue(attrBlr)) localConfig.blur = parseFloat(attrBlr);
        if (isValidValue(attrRef)) localConfig.refractiveIndex = parseFloat(attrRef);
        if (isValidValue(attrSpA)) localConfig.specularOpacity = parseFloat(attrSpA);
        if (isValidValue(attrSpG)) localConfig.specularAngle = parseFloat(attrSpG);
        if (isValidValue(attrBrt)) localConfig.brightness = parseFloat(attrBrt);
        
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
                        <feFuncA type="identity" />
                    </feComponentTransfer>
                    <feImage href="${maps.combined}" x="0" y="0" width="${rect.width}" height="${rect.height}" result="map" preserveAspectRatio="none" />
                    <feDisplacementMap in="brightened" in2="map" scale="${maps.maxScale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
                    
                    <!-- Extracting specular from Blue channel of combined map -->
                    <feColorMatrix in="map" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0" result="specWhite" />
                    <feComponentTransfer in="specWhite" result="specO"><feFuncA type="linear" slope="${localConfig.specularOpacity}" /></feComponentTransfer>
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

window.GlassEngine = { config, updateAllGlass, generateMapImages, TARGET_CLASS };

window.addEventListener('load', updateAllGlass);
window.addEventListener('resize', () => { clearTimeout(window.gRT); window.gRT = setTimeout(updateAllGlass, 150); });
