import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export type MapActivityPoint = {
  lat: number;
  lng: number;
  weight: number;
};

export type TextRankingItem = {
  name: string;
  value: number;
  fill?: string;
};

const chartPalette = [
  '#F2CA27',
  '#7E9FBA',
  '#D28B68',
  '#2A2A2A',
  '#BDC4AD',
  '#D1C4E9',
  '#F2CA27',
  '#BDC4AD',
  '#D28B68',
  '#7E9FBA',
  '#F2CA27',
];

const mosaicMapHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Detailed Mosaic Map</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://unpkg.com/topojson-client@3"></script>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #0f172a;
      touch-action: none;
    }
    #mapCanvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: default;
    }
    ::-webkit-scrollbar { display: none; }
  </style>
</head>
<body>
  <div id="loading" class="hidden" aria-hidden="true"></div>

  <canvas id="mapCanvas"></canvas>

  <script>
    let isInitialized = false;

    function initApp() {
      if (isInitialized) return;

      const canvas = document.getElementById('mapCanvas');
      const loadingEl = document.getElementById('loading');

      if (!canvas) {
        setTimeout(initApp, 50);
        return;
      }

      isInitialized = true;

      const ctx = canvas.getContext('2d', { alpha: false });
      const isFullscreen = window.IS_FULLSCREEN === true;
      canvas.style.cursor = isFullscreen ? 'grab' : 'default';

      let mapFeatures = [];
      let colorToFeature = new Map();
      let gridData = [];
      let mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

      const activityPoints = Array.isArray(window.MAP_ACTIVITY_POINTS) ? window.MAP_ACTIVITY_POINTS : [];
      let maxBlockActivityWeight = 0;

      const config = {
        blockSize: isFullscreen ? 6 : 5,
        cornerRadius: 2,
        gap: 1
      };

      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let offsetX = 0;
      let offsetY = 0;
      let scale = 1;
      let hasMoved = false;
      let dragStartClientX = 0;
      let dragStartClientY = 0;
      let drawFrame = null;
      let interactionFrame = null;
      const interactionState = {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        isDown: false,
        intensity: 0,
        time: 0
      };
      const interactionHighlightColor = [180, 180, 180];

      if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
        loadingEl.innerText = window.MAP_COPY?.mapEngineError || 'Map engine failed to load. Please check the network and refresh.';
        return;
      }

      d3.json('https://unpkg.com/world-atlas@2.0.2/countries-110m.json').then(worldData => {
        mapFeatures = topojson.feature(worldData, worldData.objects.countries).features;
        resize();
      }).catch(error => {
        console.error('加载地图数据失败:', error);
        loadingEl.innerText = window.MAP_COPY?.geoDataError || 'Could not fetch geographic data. Please refresh.';
      });

      function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        generateGrid();
      }

      window.addEventListener('resize', () => {
        clearTimeout(window.resizeTimeout);
        window.resizeTimeout = setTimeout(resize, 200);
      });

      function generateGrid() {
        loadingEl.style.opacity = '1';
        loadingEl.innerText = window.MAP_COPY?.gridLoading || 'Preparing map grid...';

        setTimeout(() => {
          gridData = [];
          colorToFeature.clear();

          const baseScale = isFullscreen
            ? Math.max(canvas.width, canvas.height) / 3.1
            : canvas.width / 6.5;
          const mapWidth = isFullscreen ? baseScale * Math.PI * 2 : canvas.width;
          const mapHeight = isFullscreen ? baseScale * Math.PI * 2 : canvas.height;
          const offscreenCanvas = document.createElement('canvas');
          const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
          offscreenCanvas.width = mapWidth;
          offscreenCanvas.height = mapHeight;

          const projection = d3.geoMercator()
            .scale(baseScale)
            .translate(isFullscreen ? [mapWidth / 2, mapHeight / 2] : [canvas.width / 2, canvas.height / 1.6]);

          const path = d3.geoPath().projection(projection).context(offscreenCtx);
          const heatRadius = isFullscreen ? Math.max(16, baseScale * 0.06) : Math.max(7, baseScale * 0.14);
          const heatRadiusSq = heatRadius * heatRadius;
          const projectedActivityPoints = activityPoints
            .map(point => {
              const lat = Number(point.lat);
              const lng = Number(point.lng);
              const weight = Math.max(0, Number(point.weight) || 0);
              const projected = Number.isFinite(lat) && Number.isFinite(lng) && weight > 0
                ? projection([lng, lat])
                : null;

              return projected ? { x: projected[0], y: projected[1], weight } : null;
            })
            .filter(Boolean);

          function getBlockHeat(x, y) {
            let heat = 0;

            projectedActivityPoints.forEach(point => {
              const dx = x - point.x;
              const dy = y - point.y;
              const distanceSq = dx * dx + dy * dy;

              if (distanceSq <= heatRadiusSq) heat += point.weight;
            });

            return heat;
          }

          mapFeatures.forEach((feature, i) => {
            const r = (i + 1) >> 16 & 255;
            const g = (i + 1) >> 8 & 255;
            const b = (i + 1) & 255;
            const colorKey = r + ',' + g + ',' + b;
            colorToFeature.set(colorKey, feature);

            offscreenCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
            offscreenCtx.beginPath();
            path(feature);
            offscreenCtx.fill();
          });

          const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height).data;

          let minGridX = Infinity;
          let maxGridX = -Infinity;
          let minGridY = Infinity;
          let maxGridY = -Infinity;

          for (let y = 0; y < offscreenCanvas.height; y += config.blockSize) {
            for (let x = 0; x < offscreenCanvas.width; x += config.blockSize) {
              const centerX = Math.floor(x + config.blockSize / 2);
              const centerY = Math.floor(y + config.blockSize / 2);

              if (centerX < offscreenCanvas.width && centerY < offscreenCanvas.height) {
                const index = (centerY * offscreenCanvas.width + centerX) * 4;
                const alpha = imageData[index + 3];

                if (alpha > 128) {
                  const r = imageData[index];
                  const g = imageData[index + 1];
                  const b = imageData[index + 2];
                  const colorKey = r + ',' + g + ',' + b;
                  const feature = colorToFeature.get(colorKey);

                  if (feature) {
                    gridData.push({
                      x,
                      y,
                      centerX,
                      centerY,
                      activityWeight: getBlockHeat(centerX, centerY)
                    });
                    if (x < minGridX) minGridX = x;
                    if (x > maxGridX) maxGridX = x;
                    if (y < minGridY) minGridY = y;
                    if (y > maxGridY) maxGridY = y;
                  }
                }
              }
            }
          }

          maxBlockActivityWeight = Math.max(0, ...gridData.map(block => block.activityWeight || 0));
          gridData = gridData.map(block => {
            const baseRgb = getBaseBlockRgb(block);
            return {
              ...block,
              baseRgb,
              baseColor: 'rgb(' + baseRgb[0] + ', ' + baseRgb[1] + ', ' + baseRgb[2] + ')'
            };
          });

          if (gridData.length > 0) {
            mapBounds = {
              minX: minGridX,
              maxX: maxGridX + config.blockSize,
              minY: minGridY,
              maxY: maxGridY + config.blockSize
            };
          } else {
            mapBounds = { minX: 0, maxX: offscreenCanvas.width, minY: 0, maxY: offscreenCanvas.height };
          }

          if (isFullscreen) {
            const focusCoords = projection([120, 35]);
            const centerX = focusCoords ? focusCoords[0] : offscreenCanvas.width / 2;
            const centerY = focusCoords ? focusCoords[1] : offscreenCanvas.height / 2;
            offsetX = canvas.width / 2 - centerX;
            offsetY = canvas.height / 2 - centerY;
            scale = 1;
          } else {
            offsetX = 0;
            offsetY = 0;
            scale = 1;
          }

          loadingEl.style.opacity = '0';
          draw();
        }, 50);
      }

      function blendRgb(base, target, amount) {
        const ratio = Math.max(0, Math.min(1, amount));
        return [
          Math.round(base[0] + (target[0] - base[0]) * ratio),
          Math.round(base[1] + (target[1] - base[1]) * ratio),
          Math.round(base[2] + (target[2] - base[2]) * ratio)
        ];
      }

      function getBaseBlockRgb(block) {
        if (!block.activityWeight || maxBlockActivityWeight === 0) {
          return [92, 92, 92];
        }

        const ratio = block.activityWeight / maxBlockActivityWeight;
        const r = Math.round(92 + (195 - 92) * ratio);
        const g = Math.round(92 + (195 - 92) * ratio);
        const b = Math.round(92 + (195 - 92) * ratio);

        return [r, g, b];
      }

      function getBlockColor(block, now) {
        let color = block.baseRgb || [92, 92, 92];
        if (interactionState.intensity <= 0.01) {
          return block.baseColor || 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')';
        }

        const dx = block.centerX - interactionState.x;
        const dy = block.centerY - interactionState.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxRadius = 150 / scale;

        if (distance < maxRadius) {
          const falloff = Math.exp(-(distance * distance) / (maxRadius * maxRadius * 0.15));
          const drift = 0.9 + 0.1 * Math.sin(interactionState.time + distance * 0.035);
          const alpha = falloff * interactionState.intensity * drift;

          if (alpha > 0.01) {
            color = blendRgb(color, interactionHighlightColor, Math.min(1, alpha));
          }
        }

        return 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')';
      }

      function roundRect(context, x, y, width, height, radius) {
        context.beginPath();
        context.moveTo(x + radius, y);
        context.arcTo(x + width, y, x + width, y + height, radius);
        context.arcTo(x + width, y + height, x, y + height, radius);
        context.arcTo(x, y + height, x, y, radius);
        context.arcTo(x, y, x + width, y, radius);
        context.closePath();
      }

      function requestDraw() {
        if (drawFrame !== null) return;
        drawFrame = requestAnimationFrame(() => {
          drawFrame = null;
          draw(performance.now());
        });
      }

      function requestInteractionFrame() {
        if (interactionFrame !== null) return;
        interactionFrame = requestAnimationFrame(animateInteraction);
      }

      function animateInteraction(timestamp) {
        interactionFrame = null;
        interactionState.time += 0.05;
        interactionState.x += (interactionState.targetX - interactionState.x) * 0.15;
        interactionState.y += (interactionState.targetY - interactionState.y) * 0.15;

        if (interactionState.isDown) {
          interactionState.intensity = Math.min(1, interactionState.intensity + 0.1);
        } else {
          interactionState.intensity = Math.max(0, interactionState.intensity - 0.05);
        }

        draw(timestamp);

        if (interactionState.isDown || interactionState.intensity > 0.01) {
          requestInteractionFrame();
        } else {
          interactionState.intensity = 0;
          requestDraw();
        }
      }

      function setInteractionTarget(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left - offsetX) / scale;
        const y = (clientY - rect.top - offsetY) / scale;
        interactionState.targetX = x;
        interactionState.targetY = y;

        if (interactionState.intensity <= 0.01) {
          interactionState.x = x;
          interactionState.y = y;
        }

        requestInteractionFrame();
      }

      function draw(now = performance.now()) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (isFullscreen) {
          const actualWidth = (mapBounds.maxX - mapBounds.minX) * scale;
          const actualHeight = (mapBounds.maxY - mapBounds.minY) * scale;
          const mapLeft = mapBounds.minX * scale;
          const mapRight = mapBounds.maxX * scale;
          const mapTop = mapBounds.minY * scale;
          const mapBottom = mapBounds.maxY * scale;

          if (actualWidth <= canvas.width) {
            offsetX = (canvas.width - actualWidth) / 2 - mapLeft;
          } else {
            offsetX = Math.max(canvas.width - mapRight, Math.min(-mapLeft, offsetX));
          }

          if (actualHeight <= canvas.height) {
            offsetY = (canvas.height - actualHeight) / 2 - mapTop;
          } else {
            offsetY = Math.max(canvas.height - mapBottom, Math.min(-mapTop, offsetY));
          }
        }

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        const viewPadding = config.blockSize * 3;
        const viewLeft = isFullscreen ? (-offsetX / scale) - viewPadding : -Infinity;
        const viewRight = isFullscreen ? ((canvas.width - offsetX) / scale) + viewPadding : Infinity;
        const viewTop = isFullscreen ? (-offsetY / scale) - viewPadding : -Infinity;
        const viewBottom = isFullscreen ? ((canvas.height - offsetY) / scale) + viewPadding : Infinity;
        const drawSize = config.blockSize - config.gap;

        gridData.forEach(block => {
          if (
            block.x > viewRight ||
            block.x + config.blockSize < viewLeft ||
            block.y > viewBottom ||
            block.y + config.blockSize < viewTop
          ) {
            return;
          }
          ctx.fillStyle = getBlockColor(block, now);
          roundRect(ctx, block.x, block.y, drawSize, drawSize, config.cornerRadius);
          ctx.fill();
        });

        ctx.restore();
      }

      function beginDrag(event) {
        isDragging = true;
        hasMoved = false;
        dragStartClientX = event.clientX;
        dragStartClientY = event.clientY;
        dragStartX = event.clientX - offsetX;
        dragStartY = event.clientY - offsetY;
        if (event.pointerId !== undefined && canvas.setPointerCapture) {
          canvas.setPointerCapture(event.pointerId);
        }
        interactionState.isDown = true;
        setInteractionTarget(event.clientX, event.clientY);
        event.preventDefault?.();
      }

      function moveDrag(event) {
        if (!isDragging) return;
        const moveDistance = Math.hypot(event.clientX - dragStartClientX, event.clientY - dragStartClientY);
        if (moveDistance > 4) hasMoved = true;
        if (hasMoved) {
          offsetX = event.clientX - dragStartX;
          offsetY = event.clientY - dragStartY;
          requestDraw();
        }
        setInteractionTarget(event.clientX, event.clientY);
        event.preventDefault?.();
      }

      function endDrag(event) {
        isDragging = false;
        interactionState.isDown = false;
        requestInteractionFrame();
        if (event?.pointerId !== undefined && canvas.releasePointerCapture) {
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch {
            // Pointer capture may already be released by the browser.
          }
        }
      }

      if (!isFullscreen) {
        return;
      }

      if (window.PointerEvent) {
        canvas.addEventListener('pointerdown', beginDrag);
        window.addEventListener('pointermove', moveDrag);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
      } else {
        canvas.addEventListener('mousedown', beginDrag);
        window.addEventListener('mousemove', moveDrag);
        window.addEventListener('mouseup', endDrag);

        canvas.addEventListener('touchstart', event => {
          if (event.touches.length !== 1) return;
          event.preventDefault();
          beginDrag(event.touches[0]);
        }, { passive: false });

        window.addEventListener('touchmove', event => {
          if (!isDragging || event.touches.length !== 1) return;
          event.preventDefault();
          moveDrag(event.touches[0]);
        }, { passive: false });

        window.addEventListener('touchend', event => {
          const touch = event.changedTouches?.[0];
          endDrag(touch);
        });
        window.addEventListener('touchcancel', endDrag);
      }

      canvas.addEventListener('click', event => {
        if (!hasMoved) event.preventDefault();
      });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(initApp, 10);
    } else {
      document.addEventListener('DOMContentLoaded', initApp);
      window.addEventListener('load', initApp);
    }
  </script>
</body>
</html>`;

const TRIP_COPY = {
  en: {
    title: 'Trip Statistics',
    markedPrefix: 'You have marked',
    markedUnit: 'locations',
    expand: 'Expand',
    rankingTitle: 'Rankings of places with the most records',
    previousRanking: 'Previous ranking',
    nextRanking: 'Next ranking',
    mosaicMap: 'Mosaic map',
    expandedMosaicMap: 'Expanded mosaic map',
    closeExpandedMap: 'Close expanded map',
    mapEngineError: 'Map engine failed to load. Please check the network and refresh.',
    geoDataError: 'Could not fetch geographic data. Please refresh.',
    gridLoading: 'Preparing map grid...',
  },
  zh: {
    title: '行程统计',
    markedPrefix: '你已标记',
    markedUnit: '个位置',
    expand: '展开',
    rankingTitle: '记录最多的位置排行',
    previousRanking: '上一页排行',
    nextRanking: '下一页排行',
    mosaicMap: '马赛克地图',
    expandedMosaicMap: '展开的马赛克地图',
    closeExpandedMap: '关闭展开地图',
    mapEngineError: '地图引擎加载失败，请检查网络或刷新重试。',
    geoDataError: '获取地理数据失败，请刷新重试。',
    gridLoading: '正在网格化地图数据...',
  },
  ko: {
    title: '여행 통계',
    markedPrefix: '표시한 위치',
    markedUnit: '곳',
    expand: '확대',
    rankingTitle: '기록이 가장 많은 장소 순위',
    previousRanking: '이전 순위',
    nextRanking: '다음 순위',
    mosaicMap: '모자이크 지도',
    expandedMosaicMap: '확대된 모자이크 지도',
    closeExpandedMap: '확대 지도 닫기',
    mapEngineError: '지도 엔진을 불러오지 못했습니다. 네트워크를 확인하고 새로고침해 주세요.',
    geoDataError: '지리 데이터를 가져오지 못했습니다. 새로고침해 주세요.',
    gridLoading: '지도 그리드를 준비하는 중...',
  },
};

type TripCopy = typeof TRIP_COPY.en;

const createMosaicMapHtml = (activityPoints: MapActivityPoint[], isFullscreen = false, copy: TripCopy = TRIP_COPY.en) => {
  const safeActivityPoints = activityPoints
    .filter(point => (
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Number.isFinite(point.weight) &&
      point.weight > 0
    ))
    .map(point => ({
      lat: point.lat,
      lng: point.lng,
      weight: point.weight,
    }));

  return mosaicMapHtml.replace(
    '</head>',
    `<script>window.IS_FULLSCREEN = ${isFullscreen ? 'true' : 'false'}; window.MAP_ACTIVITY_POINTS = ${JSON.stringify(safeActivityPoints)}; window.MAP_COPY = ${JSON.stringify({
      mapEngineError: copy.mapEngineError,
      geoDataError: copy.geoDataError,
      gridLoading: copy.gridLoading,
    })};</script></head>`
  );
};

type TripStatisticsViewProps = {
  activityPoints?: MapActivityPoint[];
  activityCount?: number;
  textRankings?: TextRankingItem[];
  language?: string;
};

const formatChartValue = (value: number) => {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
};

export function TripStatisticsView({ activityPoints = [], activityCount = 0, textRankings = [], language = 'en' }: TripStatisticsViewProps) {
  const [rankingPage, setRankingPage] = React.useState(0);
  const [expandedMapKey, setExpandedMapKey] = React.useState(0);
  const [isExpandedMapOpen, setIsExpandedMapOpen] = React.useState(false);
  const fullscreenMapRef = React.useRef<HTMLDivElement>(null);
  const mapSessionKey = React.useMemo(() => Date.now(), []);
  const copy = TRIP_COPY[language as keyof typeof TRIP_COPY] || TRIP_COPY.en;
  const mosaicHtml = React.useMemo(
    () => createMosaicMapHtml(activityPoints, false, copy),
    [activityPoints, copy]
  );
  const fullscreenMapHtml = React.useMemo(
    () => createMosaicMapHtml(activityPoints, true, copy),
    [activityPoints, copy]
  );
  const markedCount = Math.max(0, Math.round(activityCount));
  const rankingPageSize = 11;
  const maxRankingPage = Math.max(0, Math.ceil(textRankings.length / rankingPageSize) - 1);
  const chartItems = textRankings.slice(
    rankingPage * rankingPageSize,
    rankingPage * rankingPageSize + rankingPageSize
  );
  const maxChartValue = Math.max(1, ...chartItems.map(item => item.value));

  React.useEffect(() => {
    setRankingPage(0);
  }, [textRankings]);

  const openExpandedMap = React.useCallback(() => {
    setExpandedMapKey(key => key + 1);
    setIsExpandedMapOpen(true);
    requestAnimationFrame(() => fullscreenMapRef.current?.showPopover?.());
  }, []);

  const closeExpandedMap = React.useCallback(() => {
    fullscreenMapRef.current?.hidePopover?.();
    setIsExpandedMapOpen(false);
  }, []);

  return (
    <div className="absolute inset-0 z-[900] flex flex-col overflow-x-hidden overflow-y-auto bg-[var(--app-page)] pb-32 font-sans pointer-events-auto">
      <div className="flex flex-col items-center pb-6 pt-14">
        <div className="mb-6 w-[320px]">
          <h1 className="text-[36px] font-extrabold tracking-tight text-black">
            {copy.title}
          </h1>
        </div>

        <div
          className="relative mb-6 h-[345px] w-[320px] shrink-0 overflow-hidden rounded-[24px] bg-[#1A1A1A] shadow-md"
          role="button"
          tabIndex={0}
          onClick={openExpandedMap}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openExpandedMap();
            }
          }}
        >
          <iframe
            key={`mosaic-${mapSessionKey}`}
            srcDoc={mosaicHtml}
            className="h-full w-full border-none pointer-events-none"
            sandbox="allow-scripts allow-same-origin"
            title={copy.mosaicMap}
          />

          <div className="absolute left-6 top-6 pointer-events-none">
            <h2 className="text-[20px] font-bold leading-tight tracking-tight text-white">{copy.markedPrefix}</h2>
            <div className="text-[20px] font-bold leading-tight tracking-tight text-white">
              <span className="text-[#84A5C6]">{markedCount}</span> {copy.markedUnit}
            </div>
          </div>

          <button
            onClick={event => {
              event.stopPropagation();
              openExpandedMap();
            }}
            className="absolute bottom-6 right-6 z-10 rounded-full bg-[var(--app-page)] px-5 py-2 text-sm font-bold text-black shadow-lg transition-all hover:brightness-105"
          >
            {copy.expand}
          </button>
        </div>

        <div className="mb-6 flex h-[250px] w-[320px] shrink-0 flex-col justify-between rounded-[24px] bg-[var(--app-card-surface)] px-3 py-5 shadow-sm">
          <h2 className="w-[90%] px-2 text-[20px] font-bold leading-snug tracking-tight text-black">
            {copy.rankingTitle}
          </h2>

          <div className="mt-1 flex min-h-0 flex-1 -translate-y-1 items-center gap-0">
            <button
              onClick={() => setRankingPage(page => page <= 0 ? maxRankingPage : page - 1)}
              className="text-gray-300 transition-colors hover:text-gray-500"
              aria-label={copy.previousRanking}
            >
              <ChevronLeft size={28} />
            </button>

            <div className="flex h-full min-h-0 flex-1 items-end justify-start gap-2 px-1 pb-0 pt-4">
              {chartItems.map((item, index) => (
                <div key={item.name} className="flex h-full w-[18px] shrink-0 flex-col items-center justify-end">
                  <span className="mb-1 text-[11px] font-bold text-[#666]">{formatChartValue(item.value)}</span>
                  <span
                    className="w-[18px] rounded-t-[2px]"
                    style={{
                      height: `${Math.max(12, (item.value / maxChartValue) * 132)}px`,
                      backgroundColor: item.fill || chartPalette[index % chartPalette.length],
                    }}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={() => setRankingPage(page => page >= maxRankingPage ? 0 : page + 1)}
              className="text-gray-300 transition-colors hover:text-gray-500"
              aria-label={copy.nextRanking}
            >
              <ChevronRight size={28} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={fullscreenMapRef}
        id="trip-map-fullscreen"
        popover="manual"
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-[100dvw] max-w-none overflow-hidden border-0 bg-[#1A1A1A] p-0"
      >
        {isExpandedMapOpen && (
          <iframe
            key={`mosaic-fullscreen-${mapSessionKey}-${expandedMapKey}`}
            srcDoc={fullscreenMapHtml}
            className="h-full w-full border-none"
            sandbox="allow-scripts allow-same-origin"
            title={copy.expandedMosaicMap}
          />
        )}
        <button
          onClick={closeExpandedMap}
          className="absolute left-6 top-12 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/20 text-white backdrop-blur-md transition-transform active:scale-95"
          aria-label={copy.closeExpandedMap}
        >
          <X size={28} />
        </button>
      </div>
    </div>
  );
}
