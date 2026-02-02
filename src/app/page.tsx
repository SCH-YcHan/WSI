const samples = [
  "wt1-adenine-x20",
  "wt2-adenine-x20",
  "wt3-adenine-x20",
  "wt4-normal-x20",
  "wt5-normal-x20",
  "wt6-normal-x20",
];

export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="signal">Pathology Intelligence</div>
          <h1>
            <span className="hero-headline-line">인공지능 기술로</span>
            <span className="hero-headline-line">병리를 진단합니다</span>
          </h1>
          <p>
            <span className="hero-line">슬라이드 수집부터 품질 관리, 조직 구조 분석, 리포팅까지.</span>
            <span className="hero-line">임상·연구 환경에 최적화된 전 과정을 한 화면에서 보여줍니다.</span>
          </p>
          <div className="cta-row">
            <a className="cta primary" href="#samples">
              분석 예시 보기
            </a>
            <a className="cta ghost" href="/analysis-samples/hires/wt2-adenine-x20.png" target="_blank" rel="noreferrer">
              대표 고해상도 열기
            </a>
          </div>
        </div>
        <div className="hero-card">
          <div className="signal">Run Status</div>
          <p>실시간 분석 기능은 제거했으며, 현재는 예시 결과 이미지만 제공합니다.</p>
          <div className="metrics">
            <div className="metric">
              <strong>6</strong>
              <span>Example Slides</span>
            </div>
            <div className="metric">
              <strong>Static</strong>
              <span>Deployment Mode</span>
            </div>
            <div className="metric">
              <strong>JPG + PNG</strong>
              <span>Available Formats</span>
            </div>
            <div className="metric">
              <strong>Ready</strong>
              <span>Public Access</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Workspace</div>
          <h2>내 분석 공간</h2>
        </div>
        <p>기존 워크스페이스 구성은 유지하되, 실제 동작은 예시 결과 열람 중심으로 단순화했습니다.</p>
      </section>
      <section className="workspace-entry-grid">
        <div className="card workspace-entry-card">
          <div className="workspace-entry-head">
            <div>
              <div className="signal">Latest Session</div>
              <h3>Sample Session</h3>
            </div>
            <span className="badge good">READY</span>
          </div>
          <div className="workspace-entry-meta">
            <div>
              <span>파일명</span>
              <strong>wt2-adenine-x20</strong>
            </div>
            <div>
              <span>상태</span>
              <strong>예시 결과 확인 가능</strong>
            </div>
          </div>
          <div className="workspace-entry-actions">
            <a className="btn primary" href="#samples">
              분석 결과 열기
            </a>
            <a className="btn ghost" href="/analysis/wt2-adenine-x20">
              상세 보기
            </a>
          </div>
        </div>
        <div className="card workspace-entry-card">
          <div className="signal">Quick Start</div>
          <h3>샘플 고해상도 이미지</h3>
          <p className="hint">고해상도 PNG 결과를 새 탭에서 바로 열어 확대해 확인할 수 있습니다.</p>
          <div className="workspace-entry-actions">
            <a className="btn" href="/analysis-samples/hires/wt1-adenine-x20.png" target="_blank" rel="noreferrer">
              High-Res 열기
            </a>
          </div>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Platform Overview</div>
          <h2>워크플로우 구성</h2>
        </div>
        <p>데이터 수집부터 결과 공유까지의 전체 구성은 화면에서 그대로 확인할 수 있습니다.</p>
      </section>
      <section className="panel-grid">
        <div className="panel">
          <h3>Specimen Intake</h3>
          <p>WSI 업로드 및 Metadata 자동 연결</p>
        </div>
        <div className="panel">
          <h3>QC &amp; Tiling</h3>
          <p>배경 제거, 타일링, 객체 검출 수행</p>
        </div>
        <div className="panel">
          <h3>Feature Extraction</h3>
          <p>조직 패턴 및 염색 특성 지표 요약</p>
        </div>
        <div className="panel">
          <h3>Review &amp; Share</h3>
          <p>리포트 생성 및 협업 공유 지원</p>
        </div>
      </section>

      <section className="section-head">
        <div>
          <div className="section-kicker">Execution Flow</div>
          <h2>분석 파이프라인</h2>
        </div>
        <p>표준화된 4단계 흐름을 UI 상에서 확인할 수 있습니다.</p>
      </section>
      <section className="pipeline">
        <div className="step">
          <div className="signal">Step 01</div>
          <h3>Slide Ingestion</h3>
          <p>WSI 수집 및 스토리지 저장</p>
        </div>
        <div className="step">
          <div className="signal">Step 02</div>
          <h3>Quality Gates</h3>
          <p>품질 및 염색 변이 평가</p>
        </div>
        <div className="step">
          <div className="signal">Step 03</div>
          <h3>Model Inference</h3>
          <p>조직 패턴 분류 및 이상 영역 탐지</p>
        </div>
        <div className="step">
          <div className="signal">Step 04</div>
          <h3>Reporting</h3>
          <p>임상 리포트 (요약 지표, 시각화)</p>
        </div>
      </section>

      <section className="analysis-preview" id="samples">
        <div className="analysis-head">
          <div className="section-kicker">Analysis Sample</div>
          <h2>분석 예시 이미지</h2>
          <p>샘플 썸네일, 대형 JPG, 고해상도 PNG를 직접 열어 결과만 확인할 수 있습니다.</p>
        </div>
        <div className="analysis-grid">
          {samples.map((id, idx) => (
            <a
              className="analysis-tile"
              key={id}
              href={`/analysis/${id}`}
            >
              <img src={`/analysis-samples/${id}.jpg`} alt={`Analysis sample ${idx + 1}`} />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
