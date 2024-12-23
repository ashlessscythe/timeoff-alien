'use strict'

const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const ensure_user_is_admin = require('../middleware/ensure_user_is_admin')

// Show received confirmation page
router.get('/received', (req, res) => {
  res.render('messages/received', {
    logged_user: req.user,
    is_messages_page: true
  })
})

// Show message form
router.get('/new', (req, res) => {
  res.render('messages/new', {
    logged_user: req.user,
    is_messages_page: true
  })
})

// Submit new message
router.post('/', async (req, res) => {
  const { message, subject } = req.body

  try {
    await prisma.user_messages.create({
      data: {
        name: `${req.user.name} ${req.user.lastname}`,
        email: req.user.email,
        subject,
        message,
        company_id: req.user.company_id,
        user_id: req.user.id
      }
    })

    return res.redirect('/messages/received')
  } catch (error) {
    console.error('Failed to save message:', error)
    req.session.flash_messages = [
      {
        type: 'error',
        message: 'Failed to send message. Please try again.'
      }
    ]
    return res.redirect('/messages/new')
  }
})

// Admin: Get count of new messages
router.get('/count', ensure_user_is_admin, async (req, res) => {
  try {
    const count = await prisma.user_messages.count({
      where: {
        company_id: req.user.company_id,
        status: 'new'
      }
    })
    res.json({ count })
  } catch (error) {
    console.error('Failed to get message count:', error)
    res.status(500).json({ error: 'Failed to get message count' })
  }
})

// Admin: List all messages
router.get('/', ensure_user_is_admin, async (req, res) => {
  try {
    const messages = await prisma.user_messages.findMany({
      where: {
        company_id: req.user.company_id
      },
      orderBy: {
        created_at: 'desc'
      }
    })

    res.render('messages/index', {
      messages,
      logged_user: req.user,
      is_messages_page: true
    })
  } catch (error) {
    console.error('Failed to fetch messages:', error)
    req.session.flash_messages = [
      {
        type: 'error',
        message: 'Failed to load messages.'
      }
    ]
    res.redirect('/')
  }
})

// Admin: Update message status
router.post('/:id/status', ensure_user_is_admin, async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  try {
    await prisma.user_messages.update({
      where: {
        id: parseInt(id),
        company_id: req.user.company_id
      },
      data: {
        status
      }
    })

    req.session.flash_messages = [
      {
        type: 'success',
        message: 'Message status updated successfully.'
      }
    ]
  } catch (error) {
    console.error('Failed to update message status:', error)
    req.session.flash_messages = [
      {
        type: 'error',
        message: 'Failed to update message status.'
      }
    ]
  }

  res.redirect('/messages')
})

module.exports = router
