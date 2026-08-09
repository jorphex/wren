import styled from 'styled-components'

export const Onboard = styled.div`
  position: absolute;
  top: 0px;
  right: 0;
  bottom: 0;
  left: 0;
  color: var(--outerspace);
  background: var(--wren-bg-canvas);
  font-family: 'MainFont';
  font-size: 20px;
  overflow: hidden;
`

export const SlideContainer = styled.div`
  position: absolute;
  top: ${({ $immersive }) => ($immersive ? '0' : '32px')};
  right: 0;
  bottom: 0;
  left: 0;
  background: var(--wren-bg-canvas);
`

export const SlideScroller = styled.div`
  position: absolute;
  inset: 0;
`

export const Slide = styled.div`
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 700;
  box-sizing: border-box;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(7, 11, 10, 0.45) 0%, rgba(7, 11, 10, 0.08) 48%, transparent 66%),
    ${({ $background }) => ($background ? `url(${$background}) center / cover no-repeat` : 'transparent')};
`

export const SlideBody = styled.div`
  position: absolute;
  top: 112px;
  left: clamp(36px, 7vw, 54px);
  width: min(320px, 43%);
  animation: cardShow var(--wren-motion-page) ease both;
  font-weight: 350;
  font-size: 16px;
  text-align: left;
  color: var(--wren-text-secondary);

  @media (max-height: 540px) {
    top: 104px;
    font-size: 15px;
  }
`

export const SlideTitle = styled.h1`
  position: absolute;
  top: 54px;
  left: clamp(36px, 7vw, 54px);
  z-index: 800;
  margin: 0;
  width: min(340px, 46%);
  font-size: 30px;
  font-weight: 600;
  font-variation-settings: var(--wren-font-heading-settings);
  letter-spacing: -0.01em;
  animation: cardShow var(--wren-motion-page) ease both;
  animation-delay: 0s;
  line-height: 1.08;

  @media (max-height: 540px) {
    top: 48px;
    font-size: 27px;
  }
`

export const SlideProceed = styled.div`
  position: absolute;
  bottom: 34px;
  left: clamp(36px, 7vw, 54px);
  z-index: 800;
  display: flex;
  align-items: center;
  gap: var(--wren-space-3);
  animation: cardShow var(--wren-motion-page) ease both;
`

export const Shortcut = styled.span`
  display: inline-flex;
  min-height: 34px;
  padding: 0 14px;
  align-items: center;
  border: 1px solid var(--wren-accent-primary);
  border-radius: var(--wren-radius-sm);
  color: var(--wren-text-primary);
  background: var(--wren-surface-inset);
  font-family: var(--wren-font-mono);
  font-weight: 450;
  font-size: 14px;
  margin: 6px 8px;
  white-space: nowrap;
`

export const Tag = styled.span`
  display: inline;
  color: var(--wren-accent-primary-hover);
`

export const SlideItem = styled.div`
  margin: 0 0 14px;
  line-height: 1.5;

  &:last-child {
    margin-bottom: 0;
  }
`

export const BrowserChoices = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 6px;
`

export const BrowserChoice = styled.button`
  display: flex;
  width: 48px;
  height: 48px;
  padding: 6px;
  align-items: center;
  justify-content: center;
  color: var(--outerspace);
  background: transparent;
  border: 0;
  border-radius: var(--wren-radius-md);
  cursor: pointer;

  svg {
    width: 36px;
    height: 36px;
  }

  &:hover {
    background: var(--wren-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--wren-focus);
    outline-offset: 2px;
  }
`

// const cardShow = keyframes`
//   0% { opacity: 0; }
//   15.82% {
//     opacity: 0;
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -9.026, 0, 0, 1);
//   }
//   21.02% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -19.292, 0, 0, 1);
//   }
//   35.34% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3.681, 0, 0, 1);
//   }
//   49.55% {
//     opacity: 1;
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.594, 0, 0, 1);
//   }
//   78.18% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.018, 0, 0, 1);
//   }
//   100% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
//   }
// `
