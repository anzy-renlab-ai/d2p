import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockupPhasePanel } from './MockupPhasePanel.js';
import {
  mockupDrafting,
  mockupReview,
  mockupRevising,
  mockupApproved,
} from '../mock/mockupPhase.js';

describe('MockupPhasePanel', () => {
  // -------------------------------------------------------------------------
  // drafting
  // -------------------------------------------------------------------------
  describe('drafting phase', () => {
    it('renders the panel root element', () => {
      render(<MockupPhasePanel state={mockupDrafting} />);
      expect(screen.getByTestId('mockup-phase-panel')).toBeInTheDocument();
    });

    it('shows the drafting headline', () => {
      render(<MockupPhasePanel state={mockupDrafting} />);
      expect(screen.getByTestId('mockup-drafting-headline')).toHaveTextContent(
        /d2p 正在为你画产品成品的样子/,
      );
    });

    it('shows spinner element', () => {
      render(<MockupPhasePanel state={mockupDrafting} />);
      expect(screen.getByTestId('mockup-drafting-spinner')).toBeInTheDocument();
    });

    it('shows page progress "0 / 3"', () => {
      render(<MockupPhasePanel state={mockupDrafting} />);
      const progress = screen.getByTestId('mockup-drafting-progress');
      expect(progress).toHaveTextContent('0');
      expect(progress).toHaveTextContent('3');
    });
  });

  // -------------------------------------------------------------------------
  // review
  // -------------------------------------------------------------------------
  describe('review phase', () => {
    it('renders review headline', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      expect(screen.getByTestId('mockup-review-headline')).toHaveTextContent(
        /d2p 帮你画的产品预期/,
      );
    });

    it('renders page navigation thumbnails for all 3 pages', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      expect(screen.getByTestId('mockup-thumb-landing')).toBeInTheDocument();
      expect(screen.getByTestId('mockup-thumb-dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('mockup-thumb-settings')).toBeInTheDocument();
    });

    it('renders approve, revise, and skip buttons', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      expect(screen.getByTestId('mockup-approve-btn')).toBeInTheDocument();
      expect(screen.getByTestId('mockup-revise-btn')).toBeInTheDocument();
      expect(screen.getByTestId('mockup-skip-btn')).toBeInTheDocument();
    });

    it('approve button calls onApprove callback', () => {
      const onApprove = vi.fn();
      render(<MockupPhasePanel state={mockupReview} onApprove={onApprove} />);
      fireEvent.click(screen.getByTestId('mockup-approve-btn'));
      expect(onApprove).toHaveBeenCalledOnce();
    });

    it('clicking revise opens feedback textarea', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      fireEvent.click(screen.getByTestId('mockup-revise-btn'));
      expect(screen.getByTestId('mockup-feedback-input')).toBeInTheDocument();
    });

    it('submitting feedback calls onRevise with text', () => {
      const onRevise = vi.fn();
      render(<MockupPhasePanel state={mockupReview} onRevise={onRevise} />);
      fireEvent.click(screen.getByTestId('mockup-revise-btn'));
      fireEvent.change(screen.getByTestId('mockup-feedback-input'), {
        target: { value: '侧边栏太宽了' },
      });
      fireEvent.click(screen.getByTestId('mockup-revise-submit'));
      expect(onRevise).toHaveBeenCalledWith('侧边栏太宽了');
    });

    it('skip button calls onSkip callback', () => {
      const onSkip = vi.fn();
      render(<MockupPhasePanel state={mockupReview} onSkip={onSkip} />);
      fireEvent.click(screen.getByTestId('mockup-skip-btn'));
      expect(onSkip).toHaveBeenCalledOnce();
    });

    it('phase badge shows "review"', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      expect(screen.getByTestId('mockup-phase-badge')).toHaveTextContent('review');
    });

    it('renders an iframe for the active page', () => {
      render(<MockupPhasePanel state={mockupReview} />);
      expect(screen.getByTestId('mockup-iframe')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // revising
  // -------------------------------------------------------------------------
  describe('revising phase', () => {
    it('shows the revising overlay mask', () => {
      render(<MockupPhasePanel state={mockupRevising} />);
      expect(screen.getByTestId('mockup-revising-mask')).toBeInTheDocument();
    });

    it('shows the user feedback text inside the mask', () => {
      render(<MockupPhasePanel state={mockupRevising} />);
      const mask = screen.getByTestId('mockup-revising-mask');
      expect(mask).toHaveTextContent(mockupRevising.userFeedback!);
    });

    it('phase badge shows "revising"', () => {
      render(<MockupPhasePanel state={mockupRevising} />);
      expect(screen.getByTestId('mockup-phase-badge')).toHaveTextContent('revising');
    });

    it('page thumbnails still visible behind mask', () => {
      render(<MockupPhasePanel state={mockupRevising} />);
      expect(screen.getByTestId('mockup-page-nav')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // approved
  // -------------------------------------------------------------------------
  describe('approved phase', () => {
    it('shows approved headline', () => {
      render(<MockupPhasePanel state={mockupApproved} />);
      expect(screen.getByTestId('mockup-approved-headline')).toHaveTextContent(
        /已对齐预期.*differ/,
      );
    });

    it('renders thumbnail for each approved page', () => {
      render(<MockupPhasePanel state={mockupApproved} />);
      for (const page of mockupApproved.pages) {
        expect(screen.getByTestId(`mockup-approved-thumb-${page.name}`)).toBeInTheDocument();
      }
    });

    it('does not show action buttons in approved state', () => {
      render(<MockupPhasePanel state={mockupApproved} />);
      expect(screen.queryByTestId('mockup-approve-btn')).toBeNull();
      expect(screen.queryByTestId('mockup-skip-btn')).toBeNull();
    });

    it('approved thumbns container present', () => {
      render(<MockupPhasePanel state={mockupApproved} />);
      expect(screen.getByTestId('mockup-approved-thumbs')).toBeInTheDocument();
    });
  });
});
