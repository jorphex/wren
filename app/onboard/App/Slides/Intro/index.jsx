import React, { useEffect } from 'react'
import styled from 'styled-components'

import onboardingWelcome from 'url:../../../../../asset/ui/onboarding-welcome.png'
import { Slide } from '../../styled'

const Welcome = styled.div`
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(7, 11, 10, 0.5) 0%, rgba(7, 11, 10, 0.12) 48%, transparent 66%),
    url(${onboardingWelcome}) center / cover no-repeat;
  animation: cardShow 400ms linear both;
  animation-delay: 120ms;
`

const WelcomeContent = styled.div`
  position: absolute;
  top: 50%;
  left: clamp(36px, 7vw, 54px);
  width: 43%;
  transform: translateY(-50%);
  text-align: left;
`

const WelcomeTitle = styled.h1`
  margin: 0 0 14px;
  color: var(--outerspace);
  font-size: clamp(30px, 5vw, 42px);
  font-weight: 600;
  font-variation-settings:
    'CASL' 0.65,
    'CRSV' 0.25;
  line-height: 1.05;
  letter-spacing: -0.012em;
`

const WelcomeCopy = styled.p`
  margin: 0 0 24px;
  color: var(--outerspace08);
  font-size: clamp(15px, 2.25vw, 18px);
  font-weight: 350;
  line-height: 1.5;
`

const WelcomeButton = styled.button`
  min-width: 144px;
  height: 46px;
  padding: 0 22px;
  border: 1px solid var(--wren-accent-primary-hover);
  border-radius: var(--wren-radius-sm);
  color: var(--wren-text-inverse);
  background: var(--wren-accent-primary);
  box-shadow: var(--wren-shadow-sm);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 120ms ease,
    transform 120ms ease;

  &:hover {
    background: var(--wren-accent-primary-hover);
  }

  &:active {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid var(--wren-focus);
    outline-offset: 3px;
  }
`

const Intro = ({ onProceed, setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('')
    setProceed({})
  }, [])

  return (
    <Slide>
      <Welcome>
        <WelcomeContent>
          <WelcomeTitle>Meet Wren</WelcomeTitle>
          <WelcomeCopy>
            Your accounts, networks, and signing tools together in one calm desktop wallet.
          </WelcomeCopy>
          <WelcomeButton type='button' onClick={onProceed}>
            Get started
          </WelcomeButton>
        </WelcomeContent>
      </Welcome>
    </Slide>
  )
}

export default Intro
