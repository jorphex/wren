import React, { useEffect } from 'react'
import styled from 'styled-components'

import onboardingWelcome from 'url:../../../../../asset/ui/onboarding-welcome.png'
import { Slide } from '../../styled'

const Welcome = styled.div`
  position: relative;
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
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

  @media (max-width: 620px) {
    right: 28px;
    left: 28px;
    width: auto;
    max-width: 420px;
  }

  @media (max-height: 480px) {
    position: relative;
    top: auto;
    left: clamp(28px, 7vw, 54px);
    width: min(420px, calc(100% - 56px));
    min-height: 100%;
    padding: 28px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    transform: none;
  }
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
  font-size: 16px;
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
          <WelcomeButton
            type='button'
            className='wrenControl wrenControlPrimary wrenControlLarge wrenOnboardPrimary'
            onClick={onProceed}
          >
            Get started
          </WelcomeButton>
        </WelcomeContent>
      </Welcome>
    </Slide>
  )
}

export default Intro
